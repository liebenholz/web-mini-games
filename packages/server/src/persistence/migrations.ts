/**
 * 명세 10장 스키마. 순서대로 한 번씩 적용한다 (schema_migrations에 기록).
 * 이미 적용된 마이그레이션은 고치지 말고 새 항목을 추가한다.
 */
export const MIGRATIONS: ReadonlyArray<{ readonly id: string; readonly sql: string }> = [
  {
    id: '001_init',
    sql: `
CREATE TABLE players (
  id            text PRIMARY KEY,           -- 게스트 ID (로그인 방식 미결정, 명세 12장)
  nickname      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE games (
  id          uuid PRIMARY KEY,
  room_code   char(6) NOT NULL,
  options     jsonb NOT NULL,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz NOT NULL,
  end_reason  text NOT NULL
);
CREATE INDEX games_ended_at_idx ON games (ended_at DESC);

CREATE TABLE game_players (
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seat        smallint NOT NULL,
  player_id   text REFERENCES players(id),  -- 처음부터 봇이면 NULL
  nickname    text NOT NULL,
  is_bot      boolean NOT NULL,
  final_rank  smallint NOT NULL,
  PRIMARY KEY (game_id, seat)
);
CREATE INDEX game_players_player_idx ON game_players (player_id);

CREATE TABLE rounds (
  game_id       uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_no      smallint NOT NULL,
  starter_seat  smallint NOT NULL,
  dice          jsonb NOT NULL,             -- 공개 후 값만 저장
  result        jsonb NOT NULL,
  PRIMARY KEY (game_id, round_no)
);

CREATE TABLE bids (
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_no    smallint NOT NULL,
  seq         integer NOT NULL,
  seat        smallint NOT NULL,
  quantity    smallint NOT NULL,
  face        smallint NOT NULL CHECK (face BETWEEN 2 AND 6),
  is_auto     boolean NOT NULL,
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (game_id, seq)
);
`,
  },
];
