# 운영 배포 가이드: Oracle Cloud Always Free + Cloudflare + Tailscale

누구나 링크로 들어와 멀티플레이할 수 있게, 게임 서버는 Oracle Cloud VM 한 대에, 웹 클라이언트는 Cloudflare Pages에 올린다.

```
브라우저 ──https──▶ play.<도메인>  (Cloudflare Pages, 정적 파일)
   │
   └──wss──▶ api.<도메인> ──▶ Oracle VM: Caddy(443, TLS) ──▶ server:2567 ──▶ postgres, redis (내부망)

GitHub Actions ──Tailscale(tailnet)──▶ VM의 SSH(22)   ※ 22번은 인터넷에 열지 않는다
```

🙋 표시는 사람이 계정·결제·비밀값을 직접 다루는 단계다. 저장소에는 비밀값을 넣지 않는다.

## 0. 준비물

- `main`에 이 문서의 워크플로가 머지되어 있을 것
- 🙋 도메인 1개 (Cloudflare에 네임서버를 연결). 도메인이 없으면 "부록 A"를 본다
- 🙋 Oracle Cloud, Cloudflare, Tailscale 계정
- 로컬에 `ssh-keygen`, 그리고 관리용 노트북에 Tailscale 앱

## 1. Oracle Cloud 가입 🙋

1. oracle.com/cloud/free 에서 **Free Tier** 계정을 만든다. 신원 확인용으로 카드를 등록하지만, Always Free 자원만 쓰면 청구되지 않는다.
2. **홈 리전을 신중히 고른다.** 가입 후 바꿀 수 없고, Always Free 자원은 홈 리전에서만 만들 수 있다. 플레이어가 한국이면 서울(ap-seoul-1) 또는 춘천(ap-chuncheon-1)이 지연이 가장 짧다. 다만 인기 리전은 A1 자원이 자주 부족하다.
3. 처음 30일 동안은 체험 크레딧이 같이 붙는다. 실수로 유료 자원을 만들지 않도록, 콘솔에서 만들 때 "Always Free-eligible" 표시를 확인한다.
4. 오래 사용량이 적은 Always Free 인스턴스는 회수될 수 있다. 계정을 Pay As You Go로 올리면 무료 한도 안에서는 과금 없이 이를 피할 수 있다 (결제 수단이 연결되므로 예산 알림을 같이 설정한다).

"Oracle Cloud VMware Solution"은 다른 유료 상품이다. 여기서 쓰는 것은 **Compute 인스턴스(VM)**다.

## 2. VM 만들기 🙋

1. Compute → Instances → Create instance
   - Image: **Canonical Ubuntu 24.04** (aarch64)
   - Shape: **VM.Standard.A1.Flex**, 1 OCPU / 6 GB (CLAUDE.md 운영 환경. 작은 사양이 자리를 잡기 쉽다. 무료 한도는 계정 전체에 A1 4 OCPU / 24 GB)
   - 나중에 늘리려면 인스턴스 → Edit → Shape에서 OCPU와 메모리를 바꾼다. 재부팅이 한 번 필요하고, 같은 호스트에 여유가 없으면 거절될 수 있다. 늘리면 `infra/docker-compose.yml`의 서버 메모리 한도도 함께 올린다
   - Networking: 공인 IPv4 할당. 만든 뒤 **예약(Reserved) 공인 IP**로 바꿔 두면 인스턴스를 다시 만들어도 IP가 유지된다
   - SSH 키: 관리용 공개키 등록 (처음 접속과 비상용)
   - 새 VCN과 서브넷을 같이 만들면 그 화면에서는 공인 IPv4 토글을 켤 수 없는 경우가 있다. 그대로 만들고 인스턴스가 생긴 뒤 VNIC → IPv4 Addresses → Edit에서 예약 공인 IP를 붙인다
2. "Out of host capacity"가 나오면 설정 문제가 아니라 무료 A1 자리가 없는 것이다. 가용 도메인이 하나뿐인 리전(서울, 춘천, 도쿄)은 AD를 바꿀 수 없으므로, **Save as stack**으로 설정을 저장하고 "부록 C"의 스크립트로 자동 재시도한다.

## 3. 네트워크 열기 🙋

Oracle은 **두 군데**를 모두 열어야 한다.

1. **VCN Security List** (Networking → VCN → Security Lists → Ingress Rules)
   - TCP 80, 443 ← 0.0.0.0/0
   - TCP 22 ← 처음 설정하는 동안만 **내 IP/32**로 둔다. 6단계를 마치면 지운다
2. **VM 안의 iptables** (Oracle Ubuntu 이미지는 기본으로 22번 외에는 막혀 있다)

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

iptables의 22번 허용은 그대로 둔다 (tailnet으로 들어오는 SSH가 쓴다). 인터넷에서의 22번은 VCN 규칙으로 막는다. PostgreSQL(5432)과 Redis(6379)는 어디에도 열지 않는다.

## 4. VM 초기 설정

관리용 SSH로 접속해 Docker를 설치한다 (공식 저장소, arm64 지원).

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

배포 전용 사용자를 만든다 (관리 계정과 분리).

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo -u deploy mkdir -p /home/deploy/.ssh /home/deploy/wmg/infra/caddy
```

로컬에서 배포 전용 키를 만들고, 공개키(`wmg_deploy.pub`)를 VM의 `/home/deploy/.ssh/authorized_keys`에 넣는다 (권한 600, 소유자 deploy).

```bash
ssh-keygen -t ed25519 -f wmg_deploy -C wmg-deploy -N ""
```

개인키(`wmg_deploy`)는 GitHub Secret에만 넣고 저장소에는 절대 커밋하지 않는다.

## 5. Tailscale 설정 🙋

### 5-1. 접근 규칙 (Tailscale 관리 콘솔 → Access controls)

태그 두 개를 만들고, CI 노드는 서버의 22번에만, 관리자는 서버 전체에 접근하게 한다. 기존 정책 파일에 아래 항목을 합친다.

```json
{
  "tagOwners": {
    "tag:ci": ["autogroup:admin"],
    "tag:server": ["autogroup:admin"]
  },
  "grants": [
    { "src": ["tag:ci"], "dst": ["tag:server"], "ip": ["tcp:22"] },
    { "src": ["autogroup:admin"], "dst": ["tag:server"], "ip": ["*"] }
  ]
}
```

기본 정책의 "모두가 모두에게 접근" 규칙이 남아 있으면 CI 노드도 다른 기기에 닿을 수 있다. 위 규칙만 남기는 것을 권장한다.

### 5-2. VM을 tailnet에 넣기

관리 콘솔 → Settings → Keys에서 **태그 `tag:server`를 붙인 인증 키**를 하나 만든 뒤, VM에서:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=<위에서 만든 키> --hostname=wmg-server
```

- 관리 콘솔 Machines에서 `wmg-server`의 **Key expiry를 끈다** (꺼 두지 않으면 몇 달 뒤 배포가 갑자기 실패한다).
- MagicDNS가 켜져 있으면 tailnet 안에서 `wmg-server`라는 이름으로 접속된다.

### 5-3. CI용 OAuth 클라이언트

관리 콘솔 → Settings → OAuth clients → Generate

- 범위(scope): **Auth Keys 쓰기** (`auth_keys`)
- 태그: **`tag:ci`**

나오는 Client ID와 Secret을 8단계에서 GitHub Secret으로 등록한다. Secret은 다시 볼 수 없으니 바로 옮긴다.

## 6. 공개 SSH 닫기

1. 노트북에서 Tailscale에 로그인한 상태로 확인한다: `ssh deploy@wmg-server` 가 되는지 (deploy 키 사용)
2. 되면 VCN Security List에서 **22번 규칙을 지운다.** 이제 인터넷에는 80과 443만 열려 있다.
3. 확인: tailnet 밖(예: 휴대폰 데이터망)에서 `nc -vz <VM 공인 IP> 22`가 실패해야 한다.

순서를 지킨다. tailnet 접속을 확인하기 전에 22번을 닫으면 SSH로 들어갈 길이 없다. 그때는 OCI 콘솔의 인스턴스 → Console connection(시리얼 콘솔)로 들어간다.

## 7. 운영 비밀값 (.env) 🙋

VM의 `/home/deploy/wmg/infra/.env` (소유자 deploy, 권한 600):

```dotenv
POSTGRES_USER=wmg
POSTGRES_PASSWORD=<긴 무작위 값>
POSTGRES_DB=wmg
API_DOMAIN=api.<도메인>
CORS_ORIGINS=https://play.<도메인>
SHUTDOWN_DRAIN_SECONDS=900
ALONE_WITH_BOTS_POLICY=continue
```

- `ALLOW_TEST_SEED`, `GAME_TIMING_SCALE`은 넣지 않는다 (운영에서 켜면 서버가 시작을 거부한다).
- Cloudflare Pages 미리보기 주소에서도 접속하려면 `CORS_ORIGINS`에 쉼표로 추가한다.

## 8. DNS (Cloudflare) 🙋

| 이름   | 종류  | 값                              | 프록시                   |
| ------ | ----- | ------------------------------- | ------------------------ |
| `api`  | A     | VM 공인 IP                      | **DNS only (회색 구름)** |
| `play` | CNAME | Pages 프로젝트 (9단계에서 연결) | 자동                     |

`api`를 처음부터 Cloudflare 프록시(주황 구름)로 두면 Caddy의 Let's Encrypt 인증서 발급이 막힐 수 있다. 인증서가 정상 발급된 뒤 프록시를 켜려면 SSL/TLS 모드를 **Full (strict)**로 둔다. Cloudflare 프록시는 WebSocket을 지원한다.

## 9. Cloudflare Pages 🙋

1. Workers & Pages → Create → Pages → **Direct Upload** 프로젝트 생성 (이름 예: `wmg-play`). 빌드는 GitHub Actions가 하므로 Git 연동은 하지 않는다.
2. Custom domains → `play.<도메인>` 연결
3. API 토큰 생성: 권한 **Account → Cloudflare Pages → Edit**만

SPA 라우팅(`/r/:code`)과 보안 헤더는 `packages/client/public/_redirects`, `_headers`에 이미 있다.

## 10. GitHub 설정 🙋

Settings → Secrets and variables → Actions

| 종류     | 이름                     | 값                                                                     |
| -------- | ------------------------ | ---------------------------------------------------------------------- |
| Secret   | `TS_OAUTH_CLIENT_ID`     | 5-3단계 Client ID                                                      |
| Secret   | `TS_OAUTH_SECRET`        | 5-3단계 Secret                                                         |
| Secret   | `DEPLOY_SSH_HOST`        | `wmg-server` (VM의 tailnet 이름)                                       |
| Secret   | `DEPLOY_SSH_USER`        | `deploy`                                                               |
| Secret   | `DEPLOY_SSH_KEY`         | `wmg_deploy` 개인키 전체                                               |
| Secret   | `DEPLOY_SSH_KNOWN_HOSTS` | tailnet에 접속한 노트북에서 `ssh-keyscan -t ed25519 wmg-server`의 출력 |
| Secret   | `CLOUDFLARE_API_TOKEN`   | 9단계 토큰                                                             |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`  | Cloudflare 계정 ID                                                     |
| Variable | `CF_PAGES_PROJECT`       | `wmg-play`                                                             |
| Variable | `VITE_SERVER_URL`        | `wss://api.<도메인>`                                                   |

`CF_PAGES_PROJECT`를 등록하는 순간부터 `main` 머지 때 클라이언트가 배포된다 (등록 전에는 배포 작업을 건너뛴다).

추가로:

- Settings → Environments → `production` 생성 (배포 승인자를 지정하면 태그 배포 전에 한 번 더 확인한다)
- Settings → Branches → `main` 보호 (PR 필수, `ci / check` 통과 필수)
- Settings → Code security → Secret scanning, Push protection, Dependabot 켜기

## 11. 서버 이미지 접근 (GHCR)

첫 배포 뒤 GitHub → Packages → `web-mini-games/server`가 생긴다. 기본은 비공개다. 둘 중 하나를 한다.

- 패키지를 **Public**으로 바꾼다 (공개 저장소라 이미지에 비밀값은 없다). 가장 간단하다.
- 비공개로 두려면 VM에서 `read:packages` 권한만 있는 토큰으로 deploy 사용자가 `docker login ghcr.io`를 한다.

첫 배포는 이미지가 아직 비공개라 VM에서 pull이 실패할 수 있다. 그러면 패키지를 공개로 바꾸고 워크플로를 다시 실행한다 (Actions → deploy-server → Re-run).

## 12. 배포

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`deploy-server.yml`이 arm64 이미지를 빌드해 GHCR에 올리고, Tailscale로 VM에 접속해 `docker-compose.yml`과 `Caddyfile`을 복사한 뒤 `docker compose pull && up -d`를 실행한다. 처음 기동할 때 서버가 DB 마이그레이션을 적용한다.

## 13. 확인

```bash
curl -s https://api.<도메인>/healthz
```

`{"status":"ok", ...}`가 나오면 서버가 뜬 것이다. 이어서:

1. 폰과 PC에서 `https://play.<도메인>`을 열고 방을 만든다.
2. 다른 기기에서 초대 링크로 들어와 한 판을 끝까지 한다 (M5 완료 기준).
3. VM에서 기록을 확인한다: `docker compose exec postgres psql -U wmg -d wmg -c "select count(*) from games"`

## 14. 운영 메모

- **업데이트:** 새 태그(`v0.1.1`)를 올린다. 서버는 종료 신호를 받으면 새 방을 막고 진행 중인 판이 끝날 때까지(최대 15분) 기다린 뒤 교체된다. 그동안 새 방은 만들 수 없다.
- **롤백:** tailnet에서 VM에 접속해 `SERVER_IMAGE=ghcr.io/<owner>/web-mini-games/server:v0.1.0 docker compose up -d server`.
- **로그:** `docker compose logs -f server` (JSON 한 줄 로그)
- **백업:** `pgdata` 볼륨. 주기적으로 `pg_dump`를 Object Storage(무료 한도)에 올리는 작업은 아직 없다.
- **보안 업데이트:** `sudo apt-get install unattended-upgrades`로 OS 보안 패치를 자동 적용한다.
- **운영 서버에 SSH로 들어가 코드를 고치지 않는다** (CLAUDE.md). 변경은 PR과 태그로만 한다.

## 부록 A. 도메인 없이 먼저 띄워 보기

브라우저는 https 페이지에서 `wss://`만 허용하므로 서버에도 TLS 인증서가 필요하다. 도메인이 없으면 IP를 이름으로 바꿔 주는 `sslip.io`를 쓸 수 있다.

- `API_DOMAIN=<VM IP 점을 대시로>.sslip.io` (예: `203-0-113-10.sslip.io`). Caddy가 이 이름으로 인증서를 받는다.
- 클라이언트는 `<프로젝트>.pages.dev` 주소를 그대로 쓰고 `CORS_ORIGINS`에 그 주소를 넣는다.

공용 서비스라 인증서 발급 한도에 걸릴 수 있으니 시험용으로만 쓰고, 공개 전에는 도메인을 연결한다.

## 부록 B. 더 나아가기

- Tailscale의 OIDC 연동(Workload Identity Federation)을 쓰면 `TS_OAUTH_SECRET` 같은 장기 비밀값 없이 GitHub Actions가 tailnet에 들어올 수 있다. 설정이 조금 더 복잡해서 첫 배포 뒤에 옮기는 것을 권장한다.

## 부록 C. A1 자리가 날 때까지 자동 재시도

`infra/scripts/oci-retry-apply.sh`는 저장한 스택을 일정 간격(기본 10분)으로 다시 Apply하다가, 인스턴스가 만들어지면 맥 알림을 띄우고 멈춘다. "Out of host capacity"가 아닌 오류(권한, 한도 초과, 설정 오류)가 나면 재시도해도 소용없으므로 로그를 보여 주고 바로 멈춘다.

### C-1. OCI CLI 설치와 API 키 등록 🙋

```bash
brew install oci-cli
oci setup config
```

`oci setup config`가 묻는 값:

- **User OCID, Tenancy OCID:** 콘솔 오른쪽 위 프로필 → My profile(User), Tenancy 화면에서 복사
- **Region:** 홈 리전 (예: `ap-tokyo-1`)
- **새 API 키를 만들지:** `Y`. 개인키는 `~/.oci/`에 저장되고 공개키(`oci_api_key_public.pem`)도 같이 생긴다

그다음 콘솔 → My profile → **API keys → Add API key → Paste a public key**에 `oci_api_key_public.pem` 내용을 붙여 넣는다. `~/.oci/` 아래 파일은 비밀값이므로 저장소나 채팅에 올리지 않는다.

확인:

```bash
oci iam region list --output table
```

### C-2. 실행

스택 OCID는 Resource Manager → Stacks → 스택 화면의 OCID 옆 Copy로 복사한다.

```bash
caffeinate -i ./infra/scripts/oci-retry-apply.sh ocid1.ormstack.oc1....
```

- `caffeinate -i`는 기다리는 동안 맥이 잠들지 않게 한다. 노트북 덮개를 닫으면 멈추니 전원을 연결해 두고 열어 둔다
- 간격을 바꾸려면 `INTERVAL_SECONDS=900`처럼 앞에 붙인다. 5분 미만은 API 요청 제한 때문에 거부한다
- `TooManyRequests` 같은 일시적인 API 오류가 나면 멈추지 않고 간격을 두 배씩(최대 6배) 늘려 다시 시도한다. 정상 응답을 받으면 원래 간격으로 돌아온다
- 같은 스택에 스크립트를 두 번 띄우면 두 번째는 바로 멈춘다 (요청이 두 배가 되어 요청 제한에 걸리므로)
- 성공하면 "2. VM 만들기"로 돌아가 예약 공인 IP를 붙인다
- 저장한 스택의 사양은 변수가 아니라 Terraform 코드(`main.tf`의 `shape_config`)에 들어 있다. 바꾸려면 Resource Manager → 스택 → Edit → Edit stack에서 수정한 설정을 올린다. 돌고 있는 스크립트는 다음 시도부터 새 설정을 쓴다
- 며칠 동안 성공하지 못하면 Pay As You Go 전환을 검토한다 ("1. Oracle Cloud 가입" 4번)
