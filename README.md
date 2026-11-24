# web-mini-games

**WMG (Web Multiplayer Ground)**: 브라우저에서 링크 하나로 바로 플레이하는 턴제·방 기반 웹 미니게임 플랫폼. 첫 게임은 **거짓말쟁이 주사위**(2~6인, 봇 포함)이고, 오목과 원카드를 준비 중이다 ([Phase 2 계획](docs/plan/phase2.md)).

- 명세: [docs/specs/liars-dice.md](docs/specs/liars-dice.md)
- 작업 계획: [docs/plan/phase1.md](docs/plan/phase1.md), 영역별 분해: [docs/plan/phase1-tasks.md](docs/plan/phase1-tasks.md)
- 결정 기록: [docs/adr](docs/adr)
- 기여 규칙: [CLAUDE.md](CLAUDE.md)

## 구조

```
packages/
  rules/    순수 룰 엔진 (서버·클라이언트 공용, I/O·난수·시간 없음)
  server/   Colyseus 게임 서버, 봇, PostgreSQL 저장, Dockerfile
  client/   Vite + Phaser 테이블 + DOM 로비/패널
infra/      docker-compose (server, postgres, redis, caddy)
```

## 빠른 시작

Node.js 24 LTS(22.12 이상)와 pnpm 12가 필요하다.

```bash
npm install -g pnpm@12.21.0
pnpm install
pnpm --filter server dev     # ws://localhost:2567
pnpm --filter client dev     # http://localhost:5173
```

브라우저 두 개(또는 시크릿 창)로 `http://localhost:5173`에 들어가 게임을 고르고, 한쪽에서 방을 만들고, 초대 링크(`/liars-dice/r/코드`)로 다른 쪽이 들어온다. 주소 체계는 [ADR 0002](docs/adr/0002-multi-game-platform.md)를 따른다. 혼자서도 "시작"을 누르면 빈자리를 봇이 채운다.

개발 중 판을 빨리 돌려 보려면 시간 배율을 줄인다 (운영에서는 거부된다):

```bash
GAME_TIMING_SCALE=0.3 pnpm --filter server dev
```

## 검사

```bash
pnpm lint && pnpm typecheck && pnpm -r test && pnpm -r build
pnpm --filter client e2e                       # Playwright (처음 한 번: pnpm --filter client exec playwright install chromium)
TEST_DATABASE_URL=postgres://... pnpm --filter server test   # PostgreSQL 저장 테스트 포함
```

## 데이터베이스 (선택)

`DATABASE_URL`이 없으면 판 기록을 저장하지 않고 게임만 진행한다. 있으면 서버가 시작할 때 마이그레이션을 적용하고, 판이 끝날 때 한 트랜잭션으로 저장한다. DB가 잠시 내려가도 게임은 계속되고 저장은 재시도한다.

```bash
DATABASE_URL=postgres://... pnpm --filter server db:migrate   # 빌드 후 수동 적용
DATABASE_URL=postgres://... pnpm --filter server replay [game-id]   # 저장된 판을 룰로 재현·검증
```

## 배포

- 클라이언트: `main` 머지 시 Cloudflare Pages (`.github/workflows/deploy-client.yml`)
- 서버: `v*` 태그 시 arm64 이미지를 GHCR에 올리고 VM에서 `docker compose`로 교체 (`.github/workflows/deploy-server.yml`)
- 처음 올리는 절차 (Oracle VM, Cloudflare, GitHub 설정): [docs/ops/deploy-oracle.md](docs/ops/deploy-oracle.md)

## 라이선스

[MIT](LICENSE)
