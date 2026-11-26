# 부하 테스트 실행 절차 (Phase 1·2 M6)

운영 VM(Oracle A1, 2 OCPU / 12GB, 서버 컨테이너 8GB)이 동시에 몇 개의 방을 받을 수 있는지 잰다.
같은 사양의 다른 서버가 없으므로 **운영 VM에서, 사람이 없는 시간에** 한다 (2026-11-25 결정).

## 1. 무엇을 하는가

- Mac에서 부하 생성기(`packages/server/loadtest/`)가 진짜 WebSocket 접속으로 방을 만들고 끝까지 플레이한다.
  - 방장이 방을 만들고 나머지가 방 코드로 들어와 준비한다. 빈자리는 서버 봇이 채운다.
  - 가짜 사람은 0.8~2.5초 생각한 뒤 자기 차례에 서버 봇과 같은 룰 함수로 둔다.
  - 판이 끝나면 모두 나가고 그 자리에서 새 방을 만든다. 방 만들기, 판 저장, 방 정리까지 매번 거친다.
- 단계마다 동시 방 수를 올린다 (기본 5분씩). 서버 `/metrics`를 10초마다 읽어 함께 기록한다.

| 게임                                | 사람 | 서버 봇 | 기본 비율 |
| ----------------------------------- | ---- | ------- | --------- |
| 오목                                | 2    | 0       | 4         |
| 거짓말쟁이 주사위 (4인, 주사위 5개) | 3    | 1       | 2         |
| 원카드 (4인)                        | 3    | 1       | 2         |
| 숫자야구 (3자리)                    | 2    | 0       | 2         |

### 바로 멈추는 조건

- 서버 이벤트 루프 p99가 200ms(`--abort-p99`)를 두 번 연속 넘는다
- 방 만들기·입장 실패가 20번(`--max-join-failures`) 쌓인다
- 언제든 Ctrl+C

멈추면 가짜 사람이 모두 나간다. 진행 중이던 판은 사람이 모두 나간 판이 되어 기록 없이 끝난다 (E-10).

## 2. 준비 🙋

1. **시간:** 접속자가 없는 시간(예: 평일 새벽). `/healthz`의 `inProgress`가 0인지 본다.
2. **백업:** Actions → backup-db → Run workflow로 직전 백업을 하나 만든다. 테스트 기록을 지울 때 필요하면 되돌릴 수 있게 한다.
3. **지표 열기:** VM의 `~/wmg/infra/.env`에 넣는다.
   ```dotenv
   METRICS_TOKEN=<openssl rand -hex 24 로 만든 값>
   METRICS_INTERVAL_SECONDS=10
   # 부하 테스트는 Mac 한 곳에서 방을 수백 개 만든다. IP별 방 만들기 제한(기본 분당 60)을 테스트 동안만 끈다
   MATCHMAKE_PER_MINUTE=0
   ```
   ```bash
   cd ~/wmg/infra && SERVER_IMAGE=ghcr.io/<owner>/web-mini-games/server:<지금 배포된 태그> docker compose up -d server
   ```
   `SERVER_IMAGE`는 `.env`에 없고 배포할 때 CI가 붙여 넘긴다. 빼먹으면 로컬 빌드용 이름(`wmg-server:local`)을 받으려다 실패한다. 이 경우 서버는 바뀌지 않으니 이름을 붙여 다시 실행하면 된다. 지금 태그는 `docker compose ps server`의 IMAGE 열에서 본다.
4. **VM에서 따로 보기 (선택):** 다른 터미널에서 `docker stats`를 띄워 컨테이너 메모리와 Postgres CPU를 본다.

## 3. 실행 (Mac)

저장소 루트에서:

```bash
export METRICS_TOKEN=<.env와 같은 값>
pnpm --filter server loadtest -- --url wss://api.<도메인> --stages 10,25,50,100,200 --minutes 5
```

| 옵션          | 기본값                                              | 뜻                                           |
| ------------- | --------------------------------------------------- | -------------------------------------------- |
| `--stages`    | `5,10,25,50`                                        | 단계별 동시 방 수                            |
| `--minutes`   | `5`                                                 | 단계마다 유지하는 시간                       |
| `--mix`       | `gomoku:4,liars_dice:2,one_card:2,bulls_and_cows:2` | 게임 비율. 한 게임만 재려면 `--mix gomoku:1` |
| `--think`     | `800-2500`                                          | 사람이 생각하는 시간(ms)                     |
| `--abort-p99` | `200`                                               | 멈추는 이벤트 루프 p99(ms)                   |
| `--out`       | `loadtest-<시각>.json`                              | 결과 파일 (커밋하지 않는다)                  |

- 단계가 끝날 때마다 결과 파일을 다시 쓴다. 중간에 멈춰도 끝난 단계는 남는다.
- 결과 파일에 토큰은 `***`로만 남는다.
- Mac의 CPU도 본다. Mac이 먼저 바빠지면 숫자가 서버 한계가 아니다.

권장 순서: 혼합으로 한계 근처를 찾은 뒤, 게임별로 한 번씩(`--mix <게임>:1`) 같은 단계를 돈다 (M6 완료 기준: 게임별·혼합 최대 동시 방 수).

## 4. 끝난 뒤 🙋

1. **테스트 판 지우기:** 부하용 게스트 ID는 모두 `loadtest-`로 시작한다. VM의 `~/wmg/infra`에서 먼저 개수를 보고 지운다.
   ```bash
   docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   ```
   ```sql
   -- 지울 판과 게스트 수
   SELECT count(DISTINCT game_id) FROM game_players WHERE player_id LIKE 'loadtest-%';
   SELECT count(*) FROM players WHERE id LIKE 'loadtest-%';

   BEGIN;
   -- rounds, bids, game_players는 ON DELETE CASCADE로 같이 지워진다
   DELETE FROM games WHERE id IN (SELECT game_id FROM game_players WHERE player_id LIKE 'loadtest-%');
   DELETE FROM players WHERE id LIKE 'loadtest-%';
   COMMIT;
   ```
   부하용 접속은 `/visit`를 보내지 않으므로 방문자 수에는 들어가지 않는다.
2. **지표 간격과 방 만들기 제한 되돌리기:** `.env`에서 `METRICS_INTERVAL_SECONDS`, `MATCHMAKE_PER_MINUTE` 줄을 지우고 2장 3번과 같은 명령(`SERVER_IMAGE=… docker compose up -d server`)으로 다시 띄운다.
3. **확인:** `/healthz`, `/stats`(1분 캐시)가 테스트 전 숫자로 돌아왔는지 본다.
4. **보고서:** 결과 파일로 `docs/reports/load-test-YYYYMMDD.md`를 쓴다. 단계별 방 수, 접속 수, 메모리, CPU, 이벤트 루프 p99, 초당 메시지, 입장 지연, 오류, 멈춘 이유, 병목과 개선 항목.

## 5. 로컬에서 미리 해 보기

DB 없이 서버를 띄우고 작은 단계로 돌린다.

```bash
PORT=2580 METRICS_TOKEN=local-loadtest-token-0123456789 METRICS_INTERVAL_SECONDS=10 pnpm --filter server dev
```

```bash
METRICS_TOKEN=local-loadtest-token-0123456789 pnpm --filter server loadtest -- --url ws://localhost:2580 --stages 2,4 --minutes 1
```
