#!/usr/bin/env bash
# OCI Resource Manager 스택을 "Out of host capacity"가 사라질 때까지 일정 간격으로 다시 Apply한다.
# Always Free A1(Ampere) 인스턴스는 자리가 날 때만 만들어지므로, 손으로 누르는 대신 이 스크립트로 기다린다.
#
# 사용법:
#   STACK_ID=ocid1.ormstack.oc1... ./infra/scripts/oci-retry-apply.sh
#   ./infra/scripts/oci-retry-apply.sh ocid1.ormstack.oc1...
#
# 환경 변수 (모두 선택):
#   INTERVAL_SECONDS   시도 사이 대기 시간. 기본 600 (10분). 300 미만은 거부한다 (API 요청 제한 배려)
#   MAX_ATTEMPTS       최대 시도 횟수. 기본 0 (무제한)
#   JOB_TIMEOUT_SECONDS 한 번의 Apply 작업을 기다리는 최대 시간. 기본 1200
#   OCI_CLI_PROFILE    ~/.oci/config의 프로필 이름. 기본 DEFAULT
#
# 준비: OCI CLI 설치와 API 키 등록 (docs/ops/deploy-oracle.md "부록 C").
# 맥이 잠들지 않게 하려면:  caffeinate -i ./infra/scripts/oci-retry-apply.sh <stack-ocid>
#
# 멈추지 않고 기다리는 경우:
#   - 자리 부족(Out of host capacity): 다음 간격에 다시 시도
#   - 일시적인 API 오류(TooManyRequests 같은 요청 제한, 503, 네트워크 끊김): 간격을 두 배씩 늘려(최대 6배) 다시 시도.
#     정상 응답을 한 번 받으면 원래 간격으로 돌아온다
#
# 멈추는 경우:
#   - 성공(SUCCEEDED): 종료 코드 0, 알림 표시
#   - 자리 부족이 아닌 실패(권한, 한도 초과, 설정 오류): 종료 코드 1. 재시도해도 소용없으므로 로그를 보여 주고 멈춘다
#   - 같은 스택에 이 스크립트가 이미 돌고 있음: 종료 코드 1 (요청이 두 배가 되어 요청 제한에 걸리므로)
#   - MAX_ATTEMPTS 도달: 종료 코드 2
#   - Ctrl+C

set -euo pipefail

STACK_ID="${1:-${STACK_ID:-}}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-600}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-0}"
JOB_TIMEOUT_SECONDS="${JOB_TIMEOUT_SECONDS:-1200}"
PROFILE="${OCI_CLI_PROFILE:-DEFAULT}"
OCI="${OCI_BIN:-oci}"

# 자리 부족으로 보는 오류 문구 (콘솔과 Terraform 로그에 나오는 형태)
CAPACITY_PATTERN='Out of host capacity|Out of capacity|OutOfCapacity|out of capacity'
# 다른 작업이 이미 돌고 있을 때 (409). 기다렸다 다시 시도한다
BUSY_PATTERN='409|Conflict|already (a|an) (job|operation)|IncorrectState'
# 일시적인 API 오류: 요청 제한(429), 서버 일시 장애(5xx), 네트워크 끊김. 간격을 늘려 다시 시도한다
THROTTLE_PATTERN='TooManyRequests|Too many requests|429|TransientServiceError|ServiceUnavailable|503|InternalServerError|RequestException|timed out|Timeout|Connection(Error| reset| refused| aborted)|Max retries exceeded|NameResolutionError'
MAX_BACKOFF=6

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

notify() {
  # 맥이면 알림 센터에 띄운다. 다른 OS에서는 터미널 벨만 울린다
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$1\" with title \"OCI 재시도\"" >/dev/null 2>&1 || true
  fi
  printf '\a'
}

fail() { log "오류: $*" >&2; exit 1; }

[[ -n "$STACK_ID" ]] || fail "스택 OCID가 필요합니다. 사용법: $0 <stack-ocid> (또는 STACK_ID 환경 변수)"
[[ "$STACK_ID" == ocid1.ormstack.* ]] || fail "스택 OCID 형식이 아닙니다 (ocid1.ormstack.으로 시작해야 함): $STACK_ID"
[[ "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]] || fail "INTERVAL_SECONDS는 숫자여야 합니다"
(( INTERVAL_SECONDS >= 300 )) || fail "INTERVAL_SECONDS는 300초(5분) 이상으로 두세요. 너무 짧으면 API 요청 제한에 걸립니다"
[[ "$MAX_ATTEMPTS" =~ ^[0-9]+$ ]] || fail "MAX_ATTEMPTS는 숫자여야 합니다"
command -v "$OCI" >/dev/null 2>&1 || fail "OCI CLI(oci)를 찾을 수 없습니다. 설치: brew install oci-cli"

oci_cli() { "$OCI" --profile "$PROFILE" "$@"; }

# 같은 스택에 두 번 띄우지 않는다 (요청이 두 배가 되어 요청 제한에 걸린다)
LOCK_DIR="${TMPDIR:-/tmp}/oci-retry-apply.${STACK_ID##*.}.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  other="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$other" ]] && kill -0 "$other" 2>/dev/null; then
    fail "이 스택에 재시도 스크립트가 이미 실행 중입니다 (PID $other). 그 터미널을 확인하세요"
  fi
  # 이전 실행이 비정상 종료하며 남긴 잠금
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" || fail "잠금 폴더를 만들지 못했습니다: $LOCK_DIR"
fi
echo $$ >"$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT

# 시작 전에 인증과 스택 접근을 확인한다 (키 설정이 틀렸으면 여기서 바로 멈춘다. 요청 제한이면 기다렸다 다시)
for check in 1 2 3 4 5; do
  if stack_name="$(oci_cli resource-manager stack get --stack-id "$STACK_ID" --query 'data."display-name"' --raw-output 2>&1)"; then
    break
  fi
  if grep -Eqi "$THROTTLE_PATTERN" <<<"$stack_name" && (( check < 5 )); then
    log "일시적인 API 오류로 스택을 읽지 못했습니다. 2분 뒤 다시 확인합니다 ($check/5)"
    sleep 120
    continue
  fi
  fail "스택을 읽지 못했습니다. API 키 설정과 스택 OCID를 확인하세요:
$stack_name"
done
log "스택 '$stack_name'에 Apply를 반복합니다. 간격 ${INTERVAL_SECONDS}초, 최대 ${MAX_ATTEMPTS}회(0=무제한). 멈추려면 Ctrl+C"

job_error_text() {
  # 실패한 작업의 ERROR 이상 로그 메시지를 한 줄씩 돌려준다
  oci_cli resource-manager job get-job-logs --job-id "$1" --all \
    --level-greater-than-or-equal-to ERROR --query 'data[].message' --raw-output 2>/dev/null || true
}

attempt=0
backoff=1
while :; do
  attempt=$((attempt + 1))
  log "시도 #$attempt: Apply 작업을 만듭니다"

  if ! job_id="$(oci_cli resource-manager job create-apply-job \
      --stack-id "$STACK_ID" \
      --execution-plan-strategy AUTO_APPROVED \
      --query 'data.id' --raw-output 2>&1)"; then
    if grep -Eqi "$THROTTLE_PATTERN" <<<"$job_id"; then
      backoff=$(( backoff * 2 > MAX_BACKOFF ? MAX_BACKOFF : backoff * 2 ))
      log "일시적인 API 오류(요청 제한 등)입니다. 간격을 ${backoff}배로 늘려 다시 시도합니다"
    elif grep -Eqi "$BUSY_PATTERN" <<<"$job_id"; then
      log "다른 작업이 이미 실행 중입니다. 다음 간격에 다시 시도합니다"
    else
      fail "Apply 작업을 만들지 못했습니다:
$job_id"
    fi
  else
    backoff=1
    log "작업 $job_id 실행 중. 끝날 때까지 기다립니다"
    state=""
    waited=0
    # 상태 확인도 요청이므로 30초 간격으로만 묻는다
    while (( waited < JOB_TIMEOUT_SECONDS )); do
      sleep 30
      waited=$((waited + 30))
      state="$(oci_cli resource-manager job get --job-id "$job_id" --query 'data."lifecycle-state"' --raw-output 2>/dev/null || echo UNKNOWN)"
      case "$state" in
        SUCCEEDED | FAILED | CANCELED) break ;;
      esac
    done

    case "$state" in
      SUCCEEDED)
        log "성공했습니다. 콘솔의 Compute → Instances에서 인스턴스를 확인하세요"
        notify "인스턴스 생성 성공"
        exit 0
        ;;
      FAILED)
        errors="$(job_error_text "$job_id")"
        if grep -Eqi "$CAPACITY_PATTERN" <<<"$errors"; then
          log "자리 부족(Out of host capacity). 계속 기다립니다"
        else
          notify "자리 부족이 아닌 이유로 실패"
          fail "자리 부족이 아닌 이유로 실패했습니다. 재시도해도 같은 결과일 가능성이 높아 멈춥니다.
작업: $job_id
${errors:-(오류 로그를 읽지 못했습니다. 콘솔의 Resource Manager → Jobs에서 확인하세요)}"
        fi
        ;;
      CANCELED)
        log "작업이 취소되었습니다 (콘솔에서 취소했을 수 있음). 다음 간격에 다시 시도합니다"
        ;;
      *)
        log "작업이 ${JOB_TIMEOUT_SECONDS}초 안에 끝나지 않았습니다 (상태: ${state:-알 수 없음}). 콘솔에서 확인하세요. 다음 간격에 다시 시도합니다"
        ;;
    esac
  fi

  if (( MAX_ATTEMPTS > 0 && attempt >= MAX_ATTEMPTS )); then
    log "최대 시도 횟수($MAX_ATTEMPTS)에 도달해 멈춥니다"
    exit 2
  fi
  # 매번 같은 순간에 몰리지 않게 0~59초를 더한다
  pause=$((INTERVAL_SECONDS * backoff + RANDOM % 60))
  log "${pause}초 뒤에 다시 시도합니다"
  sleep "$pause"
done
