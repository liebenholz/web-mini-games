# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 따르는 프로젝트 규칙이다. 사람 기여자도 같은 규칙을 따른다.

## 프로젝트 개요

- **무엇:** 브라우저에서 링크만으로 바로 플레이하는 턴제·방 기반 **웹 미니게임 플랫폼**. 하나의 공통 프레임워크(로비, 방, 턴, 재접속, 봇) 위에 게임 모듈을 하나씩 추가한다.
- **첫 게임:** 거짓말쟁이 주사위 (2~6인). 상세 명세는 @docs/specs/liars-dice.md
- **이번 단계 작업 계획:** @docs/plan/phase1.md
- **저장소:** GitHub 퍼블릭 저장소. 모든 커밋은 공개된다고 가정하고 작업한다.
- **베팅, 재화, 결제 기능은 없다.** 이런 기능을 추가하는 코드를 만들지 않는다.

## 운영 환경 (설계 제약)

- 게임 서버는 **Oracle Cloud Always Free Ampere A1 VM 1대 (ARM64, 2 OCPU / 12GB RAM)** 에서 Docker로 실행한다.
- 서버 한 대가 게임 서버, Redis, PostgreSQL, 리버스 프록시를 함께 돌린다. **서버 성능과 안정성이 최우선**이다.
- 웹 클라이언트는 정적 파일로 빌드해서 **Cloudflare Pages**에 배포한다. 게임 서버는 정적 파일을 서빙하지 않는다.
- 모든 Docker 이미지와 네이티브 의존성은 **linux/arm64**에서 동작해야 한다. x86 전용 바이너리를 쓰는 패키지는 도입하지 않는다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| 언어 | TypeScript (strict), Node.js 현재 Active LTS |
| 패키지 관리 | pnpm workspaces (모노레포) |
| 게임 서버 | Colyseus (최신 안정 버전, 설치 시 확인) |
| 클라이언트 | Vite + Phaser + 일반 DOM UI |
| 데이터 | PostgreSQL (판 결과와 로그), Redis (매칭, 세션) |
| 테스트 | Vitest (단위), 필요 시 Playwright (E2E) |
| 코드 품질 | ESLint + Prettier |
| CI/CD | GitHub Actions, GHCR, Cloudflare Pages |

새 라이브러리를 추가하기 전에 **이 표로 해결되는지 먼저 확인**하고, 추가가 필요하면 PR 설명에 이유를 적는다.

## 저장소 구조

```
packages/
  rules/    # 순수 룰 엔진. 서버와 클라이언트가 같이 import. I/O, 타이머, 난수 생성 없음
  server/   # Colyseus 방 구현, 봇, DB 저장, Dockerfile
  client/   # Vite + Phaser 게임 화면 + DOM 로비/패널
infra/      # docker-compose.yml, 리버스 프록시 설정
docs/       # 명세서, 작업 계획, 결정 기록(ADR)
.github/    # 워크플로, 이슈/PR 템플릿
```

## 자주 쓰는 명령

```bash
pnpm install              # 의존성 설치
pnpm -r build             # 전체 빌드
pnpm -r test              # 전체 테스트
pnpm --filter rules test  # 룰 엔진 테스트만
pnpm --filter server dev  # 게임 서버 로컬 실행
pnpm --filter client dev  # 클라이언트 로컬 실행
pnpm --filter client e2e  # Playwright E2E (서버·클라이언트를 E2E 포트로 띄움)
pnpm --filter server db:migrate  # DB 마이그레이션 (DATABASE_URL 필요, 빌드 후)
pnpm --filter server replay      # 저장된 판을 룰로 재현·검증 (DATABASE_URL 필요)
pnpm lint && pnpm typecheck
pnpm format               # Prettier
```

명령 이름을 바꾸거나 새로 만들면 이 섹션도 같이 고친다.

## 아키텍처 원칙 (반드시 지킬 것)

1. **서버 권한형.** 모든 판정은 서버가 한다. 클라이언트는 의도(선언, 라이어)만 보내고 결과를 표시한다. 클라이언트 쪽 검증은 UX 편의일 뿐이다.
2. **룰은 `packages/rules`에만 있다.** 서버와 클라이언트가 같은 함수를 import한다. 같은 룰을 두 군데에 다시 구현하지 않는다.
3. **룰 엔진은 순수 함수다.** 난수가 필요하면 주사위 값을 인자로 받는다. 시간, 네트워크, DB, `Math.random`에 의존하지 않는다.
4. **숨겨진 정보는 본인에게만 보낸다.** 다른 플레이어의 주사위 눈은 공개(REVEAL) 전까지 어떤 브로드캐스트 상태나 메시지에도 넣지 않는다. Colyseus 공유 상태(schema)에 주사위 눈을 넣지 않고, 본인에게만 따로 보낸다.
5. **난수는 서버에서 `crypto.randomInt`로만 만든다.** `Math.random`은 게임 로직에서 금지한다.
6. **테스트용 시드 주입은 운영에서 꺼져 있어야 한다.** 환경 변수로만 켜지고 기본값은 OFF다. 운영 빌드에서 켜지면 서버가 시작을 거부하게 한다.
7. **이벤트 기반으로 처리한다.** 방마다 고빈도 `setInterval` 틱 루프를 두지 않는다. 턴 타이머는 마감 시각 하나에 거는 단발 타이머로 만든다.
8. **DB 쓰기는 몰아서 한다.** 선언할 때마다 쓰지 않고, 라운드나 판이 끝날 때 한 번에 쓴다. 진행 중인 판의 상태는 메모리에만 있다.
9. **봇은 서버 내부에서 돈다.** WebSocket 클라이언트로 접속하지 않고, 방 안에서 함수 호출로 행동한다.
10. **끝난 방은 반드시 정리한다.** 방이 dispose될 때 타이머, 리스너, 참조를 모두 해제한다.

## 보안 (퍼블릭 저장소)

- 비밀값(DB 비밀번호, 토큰, SSH 키)은 절대 커밋하지 않는다. `.env`는 커밋하지 않고, 키 이름만 `.env.example`에 적는다.
- 코드, 테스트, 문서에 실제 도메인의 키나 서버 IP를 넣지 않는다.
- Redis와 PostgreSQL 포트는 Docker 내부 네트워크에만 연다.
- 클라이언트 입력은 모두 신뢰하지 않는다. 타입, 범위, 차례, `turnId`를 서버에서 검증한다.
- 요청 빈도 제한(rate limit)을 둔다 (명세서 E-14).

## 코드 스타일

- TypeScript strict 모드. `any`를 쓰지 않는다. 불가피하면 이유를 주석으로 남긴다.
- 명세서의 규칙 ID(R-xx, S-xx, E-xx)를 관련 함수나 테스트 이름, 주석에 남겨서 추적할 수 있게 한다.
  - 예: `it('R-07: 같은 개수면 더 높은 눈만 허용', ...)`
- 에러 코드는 명세서의 이름(`INVALID_BID`, `NOT_YOUR_TURN`, `STALE_TURN` …)을 그대로 쓴다.
- 사용자에게 보이는 문구는 한국어로 쓰고, 코드 식별자와 커밋 메시지는 영어로 쓴다.

## 테스트 규칙

- 룰 엔진의 모든 규칙(R-01~R-13)은 단위 테스트로 검증한다. 경계값을 포함한다.
- 판정 테스트는 고정된 주사위 값으로 재현할 수 있어야 한다.
- 버그를 고치면 그 버그를 재현하는 테스트를 먼저 추가한다.
- 명세서의 대표 TC(TC-01~TC-16) 중 자동화할 수 있는 것은 자동화한다.
- `pnpm -r test`, `pnpm lint`, `pnpm typecheck`가 모두 통과해야 작업이 끝난 것이다.

## Git 작업 방식

- `main`에 직접 커밋하지 않는다. 기능 브랜치(`feat/…`, `fix/…`, `chore/…`, `docs/…`)에서 작업한다.
- 커밋 메시지는 Conventional Commits 형식: `feat(rules): add bid validation (R-05, R-07)`
- PR 하나에는 한 가지 목적만 담는다. PR 설명에 관련 명세 ID와 테스트 방법을 적는다.

## 명세와 다를 때

- 명세서가 모호하거나 구현 중에 모순을 발견하면 **임의로 결정하지 말고** 작업을 멈추고 질문한다.
- 명세서의 "미결정 사항"에 해당하는 부분은 구현하지 않거나, 기본값을 설정으로 빼 두고 TODO에 명세 ID를 남긴다.
- 명세를 바꾸는 결정을 했다면 `docs/specs/`도 같은 PR에서 고친다.

## 하지 말 것

- 다른 회사 게임의 이름, 아트, 고유 용어를 쓰지 않는다 (예: "Perudo" 상표명).
- 베팅, 재화, 결제, 광고 코드를 추가하지 않는다.
- 사용자 승인 없이 인프라(도메인, 클라우드 계정, DNS)를 바꾸는 명령을 실행하지 않는다.
- 운영 서버에 SSH로 직접 접속해서 수정하지 않는다. 배포는 CI를 거친다.
