# Phase 1 작업 분해: 클라이언트 / 서버 / 사람

`phase1.md`의 마일스톤을 영역별로 다시 나눈 목록이다. 각 항목 뒤 괄호는 명세 ID다.

## 공통 (`packages/rules`, 순수 함수)

- 타입: `DieFace`(1~6), `BidFace`(2~6), `Bid`, `TablePlayer`, `RuleOptions`
- 선언 검증 `isValidBid` (R-05, R-07, R-11), 라이어 가능 여부 `canCallLiar` (R-06, R-08)
- `minimumRaise` (S-06), `countFace` (R-09), `resolveLiar` (R-10)
- `nextStarter`, `nextTurnSeat` (R-02, R-04), `applyLoss`, `isEliminated`, `ranking` (R-12, R-13)
- `botDecide` (S-11), 방 옵션 검증 `validateRoomOptions` (4장)
- 서버와 클라이언트가 같은 함수를 import한다. 클라이언트 쪽 검증은 UX용이다.

## 서버 (`packages/server`)

| 영역 | 할 일 | 명세 |
| --- | --- | --- |
| 방 | Colyseus `LiarsDiceRoom`, 6자리 방 코드(0/O/1/I 제외), 비공개/공개 방, 최대 인원 | 4장, E-12 |
| 로비 | 입장, 준비, 옵션 변경(방장), 봇 추가/제거, 시작, 방장 위임 | 4장, E-09 |
| 상태 머신 | WAITING → STARTING → ROLLING → BIDDING → REVEAL → RESOLVE → GAME_OVER | 5장 |
| 정보 은닉 | 공유 상태(schema)에는 공개 정보만. 주사위 눈은 `your_dice`로 본인에게만 | S-01, S-02 |
| 난수 | `crypto.randomInt`, 테스트 시드는 `ALLOW_TEST_SEED=true`일 때만, 운영에서 켜지면 시작 거부 | S-03, S-04 |
| 턴 | `turnId` 발급, `STALE_TURN`, 마감 시각 단발 타이머, 자동 행동, 2연속 타임아웃 시 봇 대리 | S-05~S-07, E-06, E-07 |
| 재접속 | 60초 자리 유지, 복귀 시 상태와 `your_dice` 재전송, 이탈 시 봇 대체 | S-08~S-10, E-08 |
| 봇 | 방 내부 함수 호출, 1~3초 지연 | S-11, S-12 |
| 보안 | 입력 타입/범위/차례/turnId 검증, 초당 10회 제한, 동일 게스트 두 탭 | E-01~E-14 |
| 저장 | 판 종료 시 한 트랜잭션으로 저장, DB 실패는 재시도하고 게임은 계속 | 10장 |
| 운영 | `/healthz`, graceful shutdown(새 방 차단 후 진행 중인 방 대기), Dockerfile(arm64, non-root) | M5 |

## 클라이언트 (`packages/client`)

| 화면 | 할 일 | 명세 |
| --- | --- | --- |
| 라우팅 | `/`, `/liars-dice`, `/r/:code` (Cloudflare Pages SPA 폴백) | M4 |
| 로비 (DOM) | 닉네임 2~12자, 방 만들기, 코드로 입장, 랜덤 매칭 | 8장 |
| 대기실 (DOM) | 좌석, 준비, 옵션(방장만), 코드/링크 복사, 봇 추가, 시작 | 8장 |
| 테이블 (Phaser) | 좌석, 남은 주사위 수, 차례, 내 주사위, 현재 선언, 테이블 전체 주사위 수, 타이머 | 8장 |
| 선언 패널 (DOM) | 개수 +/−, 눈 2~6, 선언/라이어, `isValidBid`로 비활성화, `minimumRaise` 기본값 | 8장, TC-05 |
| 공개 연출 (Phaser) | 전체 주사위, 선언 눈과 1 강조, 합계, 패배자, 3초 | 8장 |
| 결과 | 순위, 리매치, 로비로 | 8장 |
| 연결 | 재접속 오버레이, 자동 재연결, 앱 전환 후 복귀 | S-08, TC-16 |
| 모바일 | 360px 세로 화면 한 손 조작, 5초 남으면 색상과 진동 | 8장 |

## 🙋 사람이 할 일

- 도메인 구입, Cloudflare DNS(`play.`, `api.`), Cloudflare Pages 프로젝트와 API 토큰
- Oracle VM에 Docker 설치, 배포용 SSH 키. OCI 보안 목록은 80/443만 개방 (SSH는 Tailscale 경유, ADR 0001)
- Tailscale: 접근 규칙(tag:ci → tag:server:22), VM 등록(`wmg-server`, 키 만료 끄기), CI용 OAuth 클라이언트
- GitHub Secrets: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DEPLOY_SSH_HOST`(tailnet 이름), `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_SSH_KNOWN_HOSTS`
- GitHub Variables: `CF_PAGES_PROJECT`, `VITE_SERVER_URL`(예: `wss://api.<도메인>`), Environment `production`
- VM의 `~/wmg/infra/.env`: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `API_DOMAIN`, `CORS_ORIGINS`. GHCR 패키지가 비공개면 VM에서 `docker login ghcr.io` (읽기 전용 토큰)
- 저장소 설정: `main` 브랜치 보호, secret scanning push protection, Dependabot
- `LICENSE`(MIT) 저작권자 최종 확인

## 진행 상황 (2026-11-22)

| 마일스톤 | 상태 | 확인 방법 |
| --- | --- | --- |
| M0 저장소 기반 | 완료 | `pnpm install && pnpm -r build && pnpm -r test` |
| M1 룰 엔진 | 완료, 라인 커버리지 100% | `pnpm --filter rules test` |
| M2 게임 서버 | 완료 | `pnpm --filter server test` (엔진 + Colyseus 통합 + 봇 1,000판) |
| M3 데이터 저장 | 코드 완료. 실제 PostgreSQL 테스트는 CI 서비스에서 실행 | `TEST_DATABASE_URL=... pnpm --filter server test` |
| M4 클라이언트 | 완료. E2E: 사람 1 + 봇 2 완주(360px), 초대 링크 2창 입장. 사람 2명이 끝까지 하는 수동 확인은 남음 | `pnpm --filter client e2e` |
| M5 인프라 | 파일 준비 완료. 🙋 계정·도메인·비밀값 등록 후 실제 배포 확인 필요 | `infra/`, `.github/workflows/` |
| M6 부하 테스트 | 미착수. 난수 분포 검정(TC-15)만 단위 테스트로 자동화 | — |
