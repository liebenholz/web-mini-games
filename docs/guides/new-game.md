# 새 게임 추가 가이드

- 작성일: 2026-11-26 (ADR 0003 P5). 2026-11-27 리버시를 이 문서대로 붙이면서 빠진 곳을 채웠다 (아래 "리버시에서 배운 것" 표시)
- 대상: 사람과 Claude Code 모두. **이 문서만 보고 게임 하나를 붙일 수 있어야 한다.** 막히는 곳이 있으면 이 문서를 고친다
- 예시: 오목(가장 작은 2인 게임)을 함께 열어 두고 따라 하면 된다

게임 하나에 새로 쓰는 것은 **명세, 룰, 서버 진행(게임 고유 부분), 화면** 네 가지다. 방, 대기실, 좌석, 재접속, 봇 대체, 이탈 기록, 리매치, 모두 나감, 연결, 대기실 화면은 공통 코드가 한다.

## 0. 이름 정하기

| 항목                 | 규칙                                                      | 예 (리버시)       |
| -------------------- | --------------------------------------------------------- | ----------------- |
| 화면 이름            | 한국어. **다른 회사 상표 이름은 쓰지 않는다** (CLAUDE.md) | 리버시 (오셀로 ✕) |
| 주소 이름 (`id`)     | 영문 소문자와 하이픈                                      | `reversi`         |
| 방 종류 (`roomType`) | 영문 소문자와 밑줄. 서버 방 이름, DB `game_type`          | `reversi`         |
| 규칙 ID 접두어       | 명세의 규칙 번호                                          | `RV-01` …         |

## 1. 명세 (먼저 쓰고 승인받는다)

`docs/specs/<id>.md`. 오목 명세(`gomoku.md`)의 목차를 따른다: 개요(결정 표), 규칙(ID), 진행, 방 옵션, 메시지(공통과 다른 것만), 시간·퇴장·재접속·봇, 화면, 예외, 기록, 대표 테스트, 결정 기록.

- 공통 구조(방 코드, 대기실, 재접속, 봇 대체, 추방)는 다시 쓰지 않고 "공통을 따른다"고만 적는다
- 정할 것이 남아 있으면 "결정 필요"로 표시하고 사람에게 묻는다 (CLAUDE.md "명세와 다를 때")
- 화면은 구현 전에 시안을 보여 주고 확인받는다 (Phase 2 진행 방식)

## 2. 룰 (`packages/rules/src/games/<id>/`)

순수 함수만. 난수·시간·I/O 없음 (원칙 3).

| 파일          | 내용                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol.ts` | `<ID>_ROOM_TYPE`, 방 옵션 타입과 기본값, `parse<Id>Options(input, base)`, 단계(phase) 타입, 클라이언트·서버 메시지 타입. 대기실 공통 메시지 8개(`set_ready` … `leave_room`)는 이름과 모양을 그대로 쓴다 |
| `<게임>.ts`   | 상태, 착수·행동 검증, 판정, 끝 판단. 규칙 ID를 주석에 단다                                                                                                                                              |
| `bot.ts`      | 봇 판단. 공개 정보와 자기 비밀 정보만 받는다 (S-12와 같은 원칙)                                                                                                                                         |
| `index.ts`    | 위를 내보낸다                                                                                                                                                                                           |

- `packages/rules/src/index.ts`에 `export * as <이름> from './games/<id>/index.js';`
- 테스트: `packages/rules/test/<id>.test.ts`. **명세의 모든 규칙 ID에 테스트**, 경계값 포함. 봇끼리 1,000판 시뮬레이션도 둔다 (`BT-12` 참고)

## 3. 서버 (`packages/server/src/games/<id>/`)

### 3-1. `state.ts` (공유 상태, 공개 정보만)

플레이어 schema에는 대기실이 쓰는 필드를 반드시 둔다: `id, nickname, isBot, isHost, ready, connected, spectator` (+ 이탈 표시가 필요하면 `replaced`, 자동 진행이 있으면 `autopilot`). 방 schema에는 `phase, roomCode, hostId, options, players, currentTurn, turnId, deadline, phaseEndsAt`. **숨긴 정보(패, 비밀 숫자)는 넣지 않는다** (원칙 4).

### 3-2. `<Id>Match.ts` (`LobbyMatch` 상속)

반드시 구현하는 훅:

| 훅                                                  | 할 일                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `maxSeats()`, `spectatorLimit()`                    | 정원, 관전 정원                                                                                                   |
| `createView(init)`, `createMember(base)`            | 플레이어 schema, 구성원에 게임 필드(색, 좌석, 패 …) 더하기                                                        |
| `parseOptions(input)`, `writeOptions()`             | 룰의 `parse…Options(input, this.opts)`, 공유 상태에 쓰기                                                          |
| `beginGame()`                                       | 카운트다운이 끝났다: 좌석·색 정하기, 게임 상태 만들기, `this.replacedIds.clear()`, `setPhase('PLAYING')`, 첫 차례 |
| `handleGame(m, type, body)`                         | 게임 메시지 처리. 차례·`turnId` 검사 후 룰 함수로 판정                                                            |
| `resendPrivate(playerId)`                           | 복귀한 사람에게 비밀 정보와 현재 `turn_start`                                                                     |
| `onSeatTakenOver(m)`                                | 게임 중 나간 자리를 봇이 이어받았다: `view.replaced = true`, 알림, 그 사람 차례면 봇 예약                         |
| `notifyReplaced(m, reason)`                         | `player_replaced` 브로드캐스트 (알림이 없는 게임은 빈 함수)                                                       |
| `resetMemberForRematch(m)`, `resetGameForRematch()` | 리매치 때 게임 필드 지우기                                                                                        |
| `isPlaying()`, `isGameOver()`                       | 단계 판단                                                                                                         |

필요할 때만 넘겨받는 훅: `minPlayers`, `checkOptions`(현재 인원보다 정원 축소 금지 등), `rematchOrder`, `notEnoughPlayersMessage`, `lobbyText`, `onStarting`(카운트다운 전에 할 일), `botDelay`(공통 기본값은 `timing`의 1~3초. 명세가 다르면 넘겨받는다, 예: 리버시 1~2초), `dispose`(게임 전용 타이머가 있으면 `super.dispose()` 뒤에 정리).

시간 초과를 "대신 행동, 2번 연속이면 봇"으로 하는 게임(원카드 C-52, 숫자야구 B-32, 리버시 RV-12)은 구성원에 `consecutiveTimeouts`를 두고, 2번째에 `m.controller = 'autopilot'`과 `view.autopilot = true`, 사람이 직접 행동하면 둘 다 되돌린다. 차례가 올 때 `controller !== 'human'`이면 봇을 예약한다. 리매치 때 `autopilot`은 공통 코드가 `human`으로 돌린다 (`view.autopilot`은 `resetMemberForRematch`에서 지운다). 오목처럼 시간패인 게임은 필요 없다.

타이머는 공통 함수만 쓴다: `setTurnTimer`, `setBotTimer`, `setPhaseTimer`, `clearTurnTimers`. 방마다 `setInterval`을 두지 않는다 (원칙 7). 난수는 `this.rng`만 (원칙 5).

판이 끝나면 IO의 `onFinished(record)`를 부른다. 기록에 `isBot: m.originallyBot`, `replaced: this.replacedIds.has(m.id)`를 넣는다 (ST-08).

### 3-3. `record.ts`

`to<Id>Summary(record): GameSummaryRecord`. `summary`에 게임별 운영 지표 값을 넣는다 (결과, 수 개수 등). 수 개수는 다른 게임처럼 `moveCount`라는 이름을 쓰면 평균 수 집계를 그대로 쓴다.

`/stats` 게임별 요약에 새 지표를 보이려면 다섯 곳을 같이 고친다 (리버시에서 배운 것):

| 파일                               | 할 일                                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/stats/stats.ts`        | `RawGameMetrics`와 `emptyRaw`에 합계 필드, `PgStatsStore.gameMetrics`의 SQL(`summary->>'키'`), `MemoryStats.#recordMetrics`, `finalizeMetrics`의 `case '<roomType>'` |
| `rules/src/stats.ts`               | `GameMetrics.extra` 주석에 키 이름                                                                                                                                   |
| `client/src/screens/stats.ts`      | `EXTRA_LABELS`에 화면 이름과 종류(rate / avg)                                                                                                                        |
| `server/test/game-metrics.test.ts` | `finalizeMetrics` 기대값 한 줄                                                                                                                                       |

비율은 5판 미만이면 `null`이다 (ST-11).

### 3-4. `<Id>Room.ts` (`GameRoom` 상속, 30~40줄)

`maxClients`, `gameMessages`(게임 메시지 이름 목록), `parseOptions`, `createMatch(code, options, rng)`(IO에 `onFinished`를 붙여 `runtime.recorder.saveSummary`). 오목 방을 그대로 베끼면 된다.

### 3-5. 등록

`packages/server/src/app.ts`의 `rooms`에 `[<roomType>]: defineRoom(<Id>Room)`.

### 3-6. 테스트

- `test/<id>-match.test.ts`: `VirtualScheduler`와 시드 난수로 진행 전체 (시작, 행동, 끝, 시간 초과, 퇴장 후 봇, 리매치, 모두 나감)
- `test/room.test.ts`: Colyseus 방 통합 한 개 (만들기, 입장, 시작, 게임 메시지 한 번, 비밀 정보가 본인에게만)
- 끝까지 가는 테스트는 방장이 두지 않게 두면 된다: 시간 초과 → 봇 대신 진행으로 판이 끝까지 간다. `scheduler.advance(30 * 60_000)` 한 번이면 충분하다 (리버시 `reversi-match.test.ts`)

## 4. 클라이언트 (`packages/client/src/games/<id>/`)

| 파일         | 내용                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.ts` | `RoomSession<View, Snapshot>` 상속. `readView`(schema → 화면 값), 게임 메시지(`onGameMessage`), 필요하면 `onState`. 만들기·입장은 `connectSession(roomType, …)`                                                                                                                  |
| `waiting.ts` | `renderWaitingShell`에 옵션 조작(`segmented`, `toggle`)과 한 줄 요약만 넘긴다                                                                                                                                                                                                    |
| `game.ts`    | 대국 화면. 360px에서 다 보이고 손가락으로 누를 수 있는 크기. 2인 판 게임은 오목 화면의 틀 클래스(`gomoku`, `gomoku-bar`, `gomoku-main`, `gomoku-side`, `gomoku-players`, `player-card`, `gomoku-notice`, `gomoku-result`, `gomoku-help`)를 그대로 쓰고 판만 새로 그린다 (리버시) |
| `flow.ts`    | 대기 중이면 대기실, 아니면 대국 화면 (오목 `flow.ts`를 그대로 베낀다)                                                                                                                                                                                                            |
| `rules.ts`   | 규칙 시트 내용 (메인 카드와 로비의 "규칙 보기")                                                                                                                                                                                                                                  |

등록:

- `games/catalog.ts`에 이름, 소개, 인원, 시간, 카테고리, `status: 'available'`
- `games/registry.ts`의 `IMPLEMENTED`에 `roomType`, `rules`, `loadFlow: () => import('./<id>/flow.js').then((m) => asFlow(m.<id>Flow))`. **flow를 직접 import하지 않는다** (메인 번들이 커진다)
- `test/registry.test.ts`의 "플레이할 수 있는 게임" 목록에 id를 더한다
- 게임 색은 `styles/tokens.css`에만 토큰으로 넣고(예: `--rv-board`), 화면 CSS는 `styles/app.css`에 게임 이름 머리말을 단 구역으로 넣는다
- 메인 카드 아이콘은 카테고리로 정해진다. 같은 카테고리면 아이콘이 같다
- **새 카테고리를 만들면** (예: 업다운의 `party`) 네 곳을 같이 고친다: `games/catalog.ts`의 `GameCategory`, `screens/hub.ts`의 `CATEGORY_ICON`·`CATEGORY_TONE`, `screens/lobby.ts`의 `heroIcons`. 아이콘은 `icons.ts`에 선 아이콘으로 그린다
- 새 에러 코드는 `rules/src/protocol.ts`의 목록과 `client/src/joinErrors.ts`의 `describeError` 문구를 같이 넣는다
- `/stats` 화면은 게임 목록에서 이름을 읽으므로 따로 할 일이 없다

테스트:

- 화면 계산이 있으면 단위 테스트 (`test/`)
- E2E `e2e/<id>.spec.ts`: 메인에서 골라 로비 → 방 만들기(빈자리 봇) → 한 판 끝까지 → 결과. 360px에서 판이 다 보이는지
  - E2E 서버는 시간 배율 0.05로 돈다 (턴 30초 → 1.5초, 봇 지연 50~150ms). 봇 응수 사이의 정확한 값(돌 수 등)을 기다리면 놓칠 수 있으니 "몇 이상"이나 "바뀌었다"로 확인한다
  - 끝까지 가는 E2E는 사람이 한두 번 두고 나머지는 시간 초과 진행에 맡기면 빠르다

## 5. 끝내기 전에

- [ ] `pnpm format && pnpm lint && pnpm typecheck && pnpm -r test`
- [ ] `pnpm --filter client e2e`
- [ ] 명세의 모든 규칙 ID에 테스트가 있다
- [ ] 숨긴 정보가 어떤 공유 상태·브로드캐스트에도 없다 (테스트로 확인)
- [ ] 360px와 1280px 화면을 직접 봤다
- [ ] PR 설명에 명세 ID와 테스트 방법. 서버가 바뀌었으면 배포 태그가 필요하다고 적는다
