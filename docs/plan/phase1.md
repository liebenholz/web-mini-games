# Phase 1 작업 계획: 공통 프레임워크 + 거짓말쟁이 주사위

## 목표

방 코드 링크를 공유받은 2~6명(봇 포함)이 브라우저에서 거짓말쟁이 주사위 한 판을 끝까지 플레이할 수 있게 한다. 이 과정에서 만드는 방, 턴, 재접속, 봇 구조는 이후 게임(원카드, 오목 등)에서 그대로 재사용한다.

## 진행 방식

- 마일스톤을 **순서대로** 진행한다. 마일스톤 하나는 PR 하나(너무 크면 여러 개)로 만든다.
- 각 마일스톤의 **완료 기준**을 모두 만족하고 `pnpm -r test`, `pnpm lint`, `pnpm typecheck`가 통과해야 다음으로 넘어간다.
- 마일스톤을 끝낼 때마다 무엇을 만들었는지, 무엇을 결정했는지, 남은 질문이 무엇인지 짧게 보고한다.
- 명세(`docs/specs/liars-dice.md`)와 다르게 구현해야 할 이유가 생기면 진행하기 전에 질문한다.
- 🙋 표시가 있는 항목은 사람이 직접 해야 하는 작업이다 (계정, 도메인, 비밀값). Claude Code는 준비만 하고, 필요한 값과 절차를 안내한다.

## M0. 저장소 기반 구성

- pnpm workspaces 모노레포 생성: `packages/rules`, `packages/server`, `packages/client`
- 공통 TypeScript 설정(strict), ESLint, Prettier, Vitest 설정
- 루트 스크립트: `build`, `test`, `lint`, `typecheck`, `format`
- `.env.example`, `LICENSE`(MIT, 사람이 최종 확인), `SECURITY.md`, `README.md` 초안
- `.github/ISSUE_TEMPLATE/bug_report.md` (재현 스텝, 기대 결과, 실제 결과, 심각도, 환경), `PULL_REQUEST_TEMPLATE.md` (관련 명세 ID, 테스트 방법)

**완료 기준**
- [ ] `pnpm install && pnpm -r build && pnpm -r test`가 깨끗한 클론에서 성공
- [ ] `rules`의 예제 함수를 `server`와 `client`가 import해서 빌드됨

## M1. 룰 엔진 (`packages/rules`)

순수 함수로만 구현한다. 난수, 시간, I/O 없음.

- 타입: `Face`(2~6 선언용, 1~6 주사위용 구분), `Bid`, `PlayerDice`, `RoundState`, `RoundResult`, `RuleOptions`
- `isValidBid(prev, next, totalDice, options)` — R-05, R-06, R-07, R-11
- `minimumRaise(prev, totalDice)` — S-06 자동 행동용
- `countFace(allDice, face, options)` — R-09 (1 와일드)
- `resolveLiar(bid, allDice, bidderSeat, callerSeat, options)` — R-10
- `nextStarter(loserSeat, aliveSeats)` — R-04
- `applyLoss(state, seat)` / `isEliminated` / `ranking` — R-12, R-13
- 봇 판단 함수 `botDecide(myDice, publicState)` — S-11 (순수 함수, 지연은 서버에서 처리)

**완료 기준**
- [ ] R-01~R-13 각각에 대응하는 테스트가 있고, 테스트 이름에 규칙 ID가 포함됨
- [ ] 명세서의 예시 라운드(3인, "3이 6개" 판정)가 테스트로 재현됨
- [ ] TC-01~TC-07의 룰 부분이 단위 테스트로 통과
- [ ] 라인 커버리지 90% 이상

## M2. 게임 서버 (`packages/server`)

- Colyseus 방 `LiarsDiceRoom` 구현: 상태 머신 WAITING → STARTING → ROLLING → BIDDING → REVEAL → RESOLVE → GAME_OVER
- 공유 상태(schema)에는 공개 정보만: 좌석, 닉네임, 남은 주사위 수, 상태, 현재 차례, 선언 기록, 마감 시각
- 주사위 눈은 서버 내부 변수로 보관하고 `your_dice`로 본인에게만 전송 (S-01, S-02)
- 난수: `crypto.randomInt`. 시드 주입은 `ALLOW_TEST_SEED=true`일 때만, `NODE_ENV=production`이면 켜져 있어도 시작 거부 (S-03, S-04)
- 메시지 핸들러: `set_ready`, `start_game`, `bid`, `call_liar`, `rematch`, `leave` + 검증과 에러 코드 (E-01~E-14)
- `turnId` 발급과 `STALE_TURN` 처리, 단발 턴 타이머와 자동 행동 (S-05, S-06, S-07)
- 재접속 60초 유지 (S-08, S-09), 이탈 시 봇 대체 (S-10)
- 봇: 방 내부에서 `botDecide` 호출, 1~3초 지연 (S-11, S-12)
- 방 코드 생성(6자리, 0/O/1/I 제외), 방장 위임 (E-09)
- 요청 빈도 제한 (E-14)
- 방 dispose 시 타이머와 참조 정리

**완료 기준**
- [ ] 통합 테스트: 봇 3명 방에서 게임이 GAME_OVER까지 진행됨
- [ ] 통합 테스트: 다른 클라이언트가 받는 모든 메시지와 상태에 공개 전 주사위 값이 없음 (TC-08, TC-09)
- [ ] 통합 테스트: 타임아웃 자동 행동, 이중 전송, 마감 경합 (TC-10, TC-11, TC-12)
- [ ] 통합 테스트: 재접속 복원, 이탈 후 봇 대체 (TC-13, TC-14)
- [ ] 봇만으로 1,000판 연속 실행 시 예외 0건, 끝난 방이 메모리에 남지 않음

## M3. 데이터 저장

- PostgreSQL 스키마와 마이그레이션 (명세서 10장 테이블)
- 판이 끝날 때 `games`, `game_players`, `rounds`, `bids`를 한 트랜잭션으로 저장
- DB가 일시적으로 실패해도 게임 진행은 막지 않음 (실패는 로그로 남기고 재시도)
- 로그인 방식은 미결정: 지금은 브라우저에 저장한 게스트 ID + 닉네임으로 처리하고 인터페이스를 분리해 둠

**완료 기준**
- [ ] 한 판이 끝나면 5개 테이블에 기록이 남음
- [ ] 저장된 `rounds`와 `bids`로 판을 재현하는 스크립트가 동작함
- [ ] DB를 끈 상태에서도 게임이 끝까지 진행됨

## M4. 클라이언트 (`packages/client`)

- Vite + TypeScript. 라우트: `/`, `/liars-dice`, `/r/:code`
- DOM: 닉네임 입력, 방 만들기, 방 코드 입장, 대기실(좌석, 준비, 옵션, 코드·링크 복사, 봇 추가, 시작), 선언 패널
- Phaser: 테이블, 좌석, 내 주사위, 선언 기록, 턴 타이머, 공개 연출
- 선언 패널은 `rules`의 `isValidBid`로 불가능한 값을 비활성화하고 `minimumRaise`를 기본값으로 제안
- 재접속 오버레이와 자동 재연결
- 360px 폭 모바일 세로 화면 대응

**완료 기준**
- [ ] 로컬에서 브라우저 2개로 방 생성 → 링크로 입장 → 한 판 완주
- [ ] 초대 링크 `/r/:code`로 바로 대기실에 들어감
- [ ] 모바일 뷰(360px)에서 모든 버튼이 화면 안에 있고 터치 가능
- [ ] Playwright E2E 1개: 사람 1명 + 봇 2명으로 한 판 완주

## M5. 인프라와 배포

- `packages/server/Dockerfile`: 멀티 스테이지, `linux/arm64` 지원, non-root 사용자
- `infra/docker-compose.yml`: server, redis, postgres, caddy(또는 nginx). DB와 Redis는 내부 네트워크만 사용
- 리버스 프록시: `api.<도메인>`에서 WebSocket 프록시, TLS
- 서버 graceful shutdown: 종료 신호를 받으면 새 방 생성을 막고 진행 중인 방이 끝날 때까지(최대 N분) 기다림
- GitHub Actions
  - `ci.yml`: PR과 push마다 typecheck, lint, test, build
  - `deploy-client.yml`: `main` 머지 시 Cloudflare Pages 배포, PR마다 미리보기
  - `deploy-server.yml`: `v*` 태그 시 `ubuntu-24.04-arm` 러너에서 이미지 빌드 → GHCR 푸시 → SSH로 `docker compose pull && docker compose up -d`
- 헬스 체크 엔드포인트 `/healthz`

🙋 **사람이 할 일** (Claude Code는 필요한 값과 절차만 안내)
- 도메인 구입과 Cloudflare DNS 설정 (`play.`, `api.`)
- Cloudflare Pages 프로젝트 생성, API 토큰 발급
- Oracle VM에 Docker 설치, 배포용 SSH 키 등록, OCI 보안 목록에서 80/443만 개방
- GitHub Secrets 등록: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`, 서버 `.env` 값
- 저장소 설정: `main` 브랜치 보호, secret scanning push protection, Dependabot

**완료 기준**
- [ ] 로컬에서 `docker compose up`으로 전체 스택이 뜨고 한 판 완주
- [ ] arm64 이미지가 GHCR에 올라감
- [ ] 실제 도메인에서 초대 링크로 한 판 완주
- [ ] 배포 중 진행 중인 판이 끊기지 않음

## M6. 부하 테스트와 안정화

- 봇 클라이언트 기반 부하 테스트 스크립트 (k6 또는 Colyseus loadtest)
- 동시 방 수를 늘려가며 메모리, CPU, 응답 지연 측정
- 결과를 `docs/reports/load-test-YYYYMMDD.md`로 정리
- 난수 분포 검증 스크립트 (TC-15): 10만 회 굴림, 카이제곱 검정

**완료 기준**
- [ ] 서버 컨테이너 메모리 8GB 이내(VM 2 OCPU / 12GB)에서 수용 가능한 최대 동시 방 수 문서화
- [ ] 병목 지점과 개선 항목 목록
- [ ] 난수 분포 검증 리포트

## 이번 단계에서 하지 않는 것

- 1 선언 허용, 정확히 맞추기 옵션 (v1.1)
- 소셜 로그인, 채팅
- 다른 게임(원카드, 오목 등). 단, 프레임워크는 재사용할 수 있게 게임별 코드와 공통 코드를 분리해 둔다
