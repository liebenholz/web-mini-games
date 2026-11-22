# 운영 배포 가이드: Oracle Cloud Always Free + Cloudflare

누구나 링크로 들어와 멀티플레이할 수 있게, 게임 서버는 Oracle Cloud VM 한 대에, 웹 클라이언트는 Cloudflare Pages에 올린다.

```
브라우저 ──https──▶ play.<도메인>  (Cloudflare Pages, 정적 파일)
   │
   └──wss──▶ api.<도메인> ──▶ Oracle VM: Caddy(443, TLS) ──▶ server:2567 ──▶ postgres, redis (내부망)
```

🙋 표시는 사람이 계정·결제·비밀값을 직접 다루는 단계다. 저장소에는 비밀값을 넣지 않는다.

## 0. 준비물

- 저장소가 GitHub에 push되어 있을 것 (`main` 기준, 이 문서의 워크플로 포함)
- 🙋 도메인 1개 (Cloudflare에 네임서버를 연결). 도메인이 없으면 "부록 A"를 본다
- 🙋 Oracle Cloud 계정 (Always Free), Cloudflare 계정
- 로컬에 SSH 키 생성 도구 (`ssh-keygen`)

## 1. Oracle VM 만들기 🙋

1. OCI 콘솔 → Compute → Instances → Create instance
   - Image: **Canonical Ubuntu 24.04** (aarch64)
   - Shape: **VM.Standard.A1.Flex**, 2 OCPU / 12 GB (CLAUDE.md 운영 환경)
   - Networking: 공인 IPv4 할당. 가능하면 **예약(Reserved) 공인 IP**로 바꿔 둔다 (재생성해도 IP 유지)
   - SSH 키: 관리용 공개키 등록
2. "Out of capacity"가 나오면 다른 가용 도메인(AD)을 고르거나 시간을 두고 다시 시도한다.
3. Always Free 인스턴스는 오래 놀면(CPU 사용률이 계속 낮으면) 회수될 수 있다. 계정을 Pay As You Go로 올리면 무료 한도 안에서는 과금 없이 회수 정책을 피할 수 있다 (결제 수단 등록 필요, 사람이 판단).

## 2. 네트워크 열기 🙋

Oracle은 **두 군데**를 모두 열어야 한다. 하나만 열면 접속이 안 된다.

1. **VCN Security List** (콘솔 → Networking → VCN → Security Lists → Ingress Rules)
   - TCP 80, 443 ← 0.0.0.0/0
   - TCP 22 ← 아래 "3. SSH 정책"에 따라
2. **VM 안의 iptables** (Oracle Ubuntu 이미지는 기본으로 22번 외에는 막혀 있다)

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

PostgreSQL(5432)과 Redis(6379)는 열지 않는다. compose에서 내부 네트워크에만 둔다.

## 3. SSH 정책 정하기 (결정 필요)

`deploy-server.yml`은 GitHub Actions 러너가 SSH로 VM에 접속해 `docker compose`를 실행한다. 러너 IP는 고정이 아니어서 phase1 계획의 "80/443만 개방"과 충돌한다. 셋 중 하나를 고른다.

| 방식                   | 22번 포트 | 장점                   | 단점                                                    |
| ---------------------- | --------- | ---------------------- | ------------------------------------------------------- |
| A. 공개 SSH, 키 전용   | 0.0.0.0/0 | 워크플로 그대로 사용   | 계획과 다름. 비밀번호 로그인 끄기, fail2ban 권장        |
| B. Tailscale 경유      | 닫음      | 계획대로 80/443만 개방 | 워크플로 수정 필요 (Tailscale 액션), Tailscale 계정     |
| C. VM이 당겨오기(pull) | 닫음      | 외부 접속 경로 없음    | VM에 갱신 스크립트/타이머 필요, 배포 시점 제어가 느슨함 |

권장은 **B**다. 고르면 워크플로를 그에 맞게 고친다.

## 4. VM 초기 설정

관리용 SSH로 접속해서 Docker를 설치한다 (공식 저장소, arm64 지원).

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

로컬에서 배포 전용 키를 만들고 공개키를 VM의 `deploy` 사용자에 등록한다.

```bash
ssh-keygen -t ed25519 -f wmg_deploy -C wmg-deploy -N ""
```

`wmg_deploy.pub` 내용을 VM의 `/home/deploy/.ssh/authorized_keys`에 넣고 권한을 600으로 둔다. 개인키(`wmg_deploy`)는 GitHub Secret에만 넣고 저장소에는 절대 커밋하지 않는다.

## 5. 운영 비밀값 (.env) 🙋

VM의 `/home/deploy/wmg/infra/.env` (deploy 사용자 소유, 권한 600):

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

## 6. DNS (Cloudflare) 🙋

| 이름   | 종류  | 값                              | 프록시                   |
| ------ | ----- | ------------------------------- | ------------------------ |
| `api`  | A     | VM 공인 IP                      | **DNS only (회색 구름)** |
| `play` | CNAME | Pages 프로젝트 (7단계에서 연결) | 자동                     |

`api`를 처음부터 Cloudflare 프록시(주황 구름)로 두면 Caddy의 Let's Encrypt 인증서 발급이 막힐 수 있다. 인증서가 정상 발급된 뒤 프록시를 켜려면 SSL/TLS 모드를 **Full (strict)**로 둔다. Cloudflare 프록시는 WebSocket을 지원한다.

## 7. Cloudflare Pages 🙋

1. Workers & Pages → Create → Pages → **Direct Upload** 프로젝트 생성 (이름 예: `wmg-play`). 빌드는 GitHub Actions가 하므로 Git 연동은 하지 않는다.
2. Custom domains → `play.<도메인>` 연결
3. API 토큰 생성: 권한 **Account → Cloudflare Pages → Edit**만

SPA 라우팅(`/r/:code`)과 보안 헤더는 `packages/client/public/_redirects`, `_headers`에 이미 있다.

## 8. GitHub 설정 🙋

Settings → Secrets and variables → Actions

| 종류     | 이름                     | 값                                    |
| -------- | ------------------------ | ------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`   | 7단계 토큰                            |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`  | Cloudflare 계정 ID                    |
| Secret   | `DEPLOY_SSH_HOST`        | `api.<도메인>` 또는 VM IP             |
| Secret   | `DEPLOY_SSH_USER`        | `deploy`                              |
| Secret   | `DEPLOY_SSH_KEY`         | `wmg_deploy` 개인키 전체              |
| Secret   | `DEPLOY_SSH_KNOWN_HOSTS` | `ssh-keyscan -t ed25519 <VM IP>` 출력 |
| Variable | `CF_PAGES_PROJECT`       | `wmg-play`                            |
| Variable | `VITE_SERVER_URL`        | `wss://api.<도메인>`                  |

추가로:

- Settings → Environments → `production` 생성 (배포 승인자를 지정하면 태그 배포 전에 한 번 더 확인한다)
- Settings → Branches → `main` 보호 (PR 필수, CI 통과 필수)
- Settings → Code security → Secret scanning, Push protection, Dependabot 켜기

## 9. 서버 이미지 접근 (GHCR)

첫 배포 뒤 GitHub → Packages → `web-mini-games/server`가 생긴다. 기본은 비공개다. 둘 중 하나를 한다.

- 패키지를 **Public**으로 바꾼다 (공개 저장소라 이미지에 비밀값은 없다). 가장 간단하다.
- 비공개로 두려면 VM에서 `read:packages` 권한만 있는 토큰으로 `deploy` 사용자가 `docker login ghcr.io`를 한다.

## 10. 배포 순서

1. 기능 브랜치를 PR로 `main`에 머지한다. `ci.yml`이 통과해야 한다.
2. `main` 머지 시 `deploy-client.yml`이 `play.<도메인>`에 클라이언트를 올린다.
3. 서버는 태그로 배포한다.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`deploy-server.yml`이 arm64 이미지를 빌드해 GHCR에 올리고, VM에 `docker-compose.yml`과 `Caddyfile`을 복사한 뒤 `docker compose pull && up -d`를 실행한다. 처음 기동할 때 서버가 DB 마이그레이션을 적용한다.

## 11. 확인

```bash
curl -s https://api.<도메인>/healthz
```

`{"status":"ok", ...}`가 나오면 서버가 뜬 것이다. 이어서:

1. 폰과 PC에서 `https://play.<도메인>`을 열고 방을 만든다.
2. 다른 기기에서 초대 링크로 들어와 한 판을 끝까지 한다 (M5 완료 기준).
3. VM에서 기록을 확인한다: `docker compose exec postgres psql -U wmg -d wmg -c "select count(*) from games"`

## 12. 운영 메모

- **업데이트:** 새 태그(`v0.1.1`)를 올리면 된다. 서버는 종료 신호를 받으면 새 방을 막고 진행 중인 판이 끝날 때까지(최대 15분) 기다린 뒤 교체된다. 그동안 새 방은 만들 수 없다.
- **롤백:** 이전 태그로 VM에서 `SERVER_IMAGE=ghcr.io/<owner>/web-mini-games/server:v0.1.0 docker compose up -d server`.
- **로그:** `docker compose logs -f server` (JSON 한 줄 로그)
- **백업:** `pgdata` 볼륨. 주기적으로 `pg_dump`를 Object Storage(무료 한도)에 올리는 작업은 아직 없다.
- **운영 서버에 SSH로 들어가 코드를 고치지 않는다** (CLAUDE.md). 변경은 PR과 태그로만 한다.

## 부록 A. 도메인 없이 먼저 띄워 보기

브라우저는 https 페이지에서 `wss://`만 허용하므로 서버에도 TLS 인증서가 필요하다. 도메인이 없으면 IP를 이름으로 바꿔 주는 `sslip.io`를 쓸 수 있다.

- `API_DOMAIN=<VM IP 점을 대시로>.sslip.io` (예: `203-0-113-10.sslip.io`). Caddy가 이 이름으로 인증서를 받는다.
- 클라이언트는 `<프로젝트>.pages.dev` 주소를 그대로 쓰고 `CORS_ORIGINS`에 그 주소를 넣는다.

공용 서비스라 인증서 발급 한도에 걸릴 수 있으니 시험용으로만 쓰고, 공개 전에는 도메인을 연결한다.
