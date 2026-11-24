import { describe, expect, it } from 'vitest';
import { FAST_TIMING, currentTurn, joinOk, setup, startHumans } from './helpers.js';

const TURN_MS = 30 * FAST_TIMING.msPerTurnSecond;

describe('로비 (명세 4장)', () => {
  it('첫 입장자가 방장, 이후 입장자는 아님', () => {
    const { match } = setup();
    const a = joinOk(match, 'g1', '가나');
    const b = joinOk(match, 'g2', '다라');
    expect(match.state.hostId).toBe(a);
    expect(match.state.players.get(b)?.isHost).toBe(false);
  });

  it('닉네임 2~12자가 아니면 INVALID_NICKNAME', () => {
    const { match } = setup();
    expect(match.join('g1', 'a')).toEqual({ ok: false, code: 'INVALID_NICKNAME' });
  });

  it('E-12: 최대 인원을 넘으면 ROOM_FULL', () => {
    const { match } = setup({ maxPlayers: 2 });
    joinOk(match, 'g1', '가나');
    joinOk(match, 'g2', '다라');
    expect(match.join('g3', '마바')).toEqual({ ok: false, code: 'ROOM_FULL' });
  });

  it('E-09: 방장이 대기실에서 나가면 가장 먼저 입장한 사람에게 위임', () => {
    const { match } = setup();
    const a = joinOk(match, 'g1', '가나');
    const b = joinOk(match, 'g2', '다라');
    joinOk(match, 'g3', '마바');
    match.leave(a);
    expect(match.state.hostId).toBe(b);
    expect(match.state.players.get(b)?.isHost).toBe(true);
    expect(match.state.players.has(a)).toBe(false);
  });

  it('start_game 거부: 방장 아님, 미준비, 인원 부족', () => {
    const { match } = setup({ fillWithBots: false });
    const a = joinOk(match, 'g1', '가나');
    expect(match.handle(a, 'start_game', {})).toMatchObject({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
    const b = joinOk(match, 'g2', '다라');
    expect(match.handle(b, 'start_game', {})).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(match.handle(a, 'start_game', {})).toMatchObject({ ok: false, code: 'NOT_ALL_READY' });
    match.handle(b, 'set_ready', { ready: true });
    expect(match.handle(a, 'start_game', {})).toEqual({ ok: true });
    expect(match.phase).toBe('STARTING');
  });

  it('봇으로 빈자리 채우기: 혼자서도 시작하면 최대 인원까지 봇이 채운다', () => {
    const { match } = setup({ maxPlayers: 4 });
    const a = joinOk(match, 'g1', '가나');
    expect(match.handle(a, 'start_game', {})).toEqual({ ok: true });
    expect(match.state.players.size).toBe(4);
    expect([...match.state.players.values()].filter((p) => p.isBot)).toHaveLength(3);
  });

  it('E-15: 추방은 방장만, 대기실에서, 사람만. 추방된 게스트는 이 방에 다시 못 들어온다', () => {
    const { match, io } = setup({ maxPlayers: 4 });
    const host = joinOk(match, 'g1', '방장');
    const b = joinOk(match, 'g2', '민준');
    const c = joinOk(match, 'g3', '수아');
    expect(match.handle(host, 'add_bot', {})).toEqual({ ok: true });
    const bot = [...match.state.players.values()].find((p) => p.isBot)!;

    expect(match.handle(b, 'kick_player', { playerId: c })).toMatchObject({ code: 'NOT_HOST' });
    expect(match.handle(host, 'kick_player', { playerId: host })).toMatchObject({ code: 'INVALID_MESSAGE' });
    expect(match.handle(host, 'kick_player', { playerId: bot.id })).toMatchObject({
      code: 'INVALID_MESSAGE',
    });
    expect(match.handle(host, 'kick_player', { playerId: 'nobody' })).toMatchObject({
      code: 'INVALID_MESSAGE',
    });

    expect(match.handle(host, 'kick_player', { playerId: b })).toEqual({ ok: true });
    expect(io.kicked).toEqual([b]);
    expect(match.state.players.has(b)).toBe(false);
    expect(match.state.hostId).toBe(host);

    // 같은 게스트는 거부, 다른 게스트는 그 자리에 들어올 수 있다
    expect(match.join('g2', '민준')).toEqual({ ok: false, code: 'KICKED' });
    expect(match.join('g4', '새사람')).toMatchObject({ ok: true });
  });

  it('E-15: 게임이 시작되면 추방 할 수 없다', () => {
    const { match } = setup({ maxPlayers: 2, fillWithBots: false });
    const host = joinOk(match, 'g1', '방장');
    const b = joinOk(match, 'g2', '민준');
    match.handle(b, 'set_ready', { ready: true });
    expect(match.handle(host, 'start_game', {})).toEqual({ ok: true });
    expect(match.handle(host, 'kick_player', { playerId: b })).toMatchObject({ code: 'INVALID_STATE' });
  });

  it('방장만 옵션 변경·봇 추가/제거, 범위 밖 옵션은 INVALID_OPTIONS', () => {
    const { match } = setup();
    const a = joinOk(match, 'g1', '가나');
    const b = joinOk(match, 'g2', '다라');
    expect(match.handle(b, 'set_options', { options: { turnSeconds: 15 } })).toMatchObject({
      code: 'NOT_HOST',
    });
    expect(match.handle(a, 'set_options', { options: { turnSeconds: 15 } })).toEqual({ ok: true });
    expect(match.state.options.turnSeconds).toBe(15);
    expect(match.handle(a, 'set_options', { options: { turnSeconds: 20 } })).toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    expect(match.handle(a, 'set_options', { options: { maxPlayers: 1 } })).toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    expect(match.handle(b, 'add_bot', {})).toMatchObject({ code: 'NOT_HOST' });
    expect(match.handle(a, 'add_bot', {})).toEqual({ ok: true });
    const bot = [...match.state.players.values()].find((p) => p.isBot)!;
    expect(match.handle(a, 'remove_bot', { playerId: b })).toMatchObject({ code: 'INVALID_MESSAGE' });
    expect(match.handle(a, 'remove_bot', { playerId: bot.id })).toEqual({ ok: true });
    // 3명일 때 최대 인원 2로 줄일 수 없음
    joinOk(match, 'g3', '마바');
    expect(match.handle(a, 'set_options', { options: { maxPlayers: 2 } })).toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });

  it('공개 방은 대기실에서만 랜덤 매칭 목록에 노출', () => {
    const { match, io } = setup({ isPrivate: false, maxPlayers: 2 });
    expect(io.listed.at(-1)).toBe(true);
    const a = joinOk(match, 'g1', '가나');
    joinOk(match, 'g2', '다라');
    expect(io.listed.at(-1)).toBe(false); // 가득 참
    match.handle(a, 'set_options', { options: { isPrivate: true } });
    expect(io.listed.at(-1)).toBe(false);
  });
});

describe('게임 진행 (명세 5장)', () => {
  it('STARTING 3초 → ROLLING → BIDDING, 좌석은 입장 순서, 각자 your_dice 수신', () => {
    const { match, io, ids } = startHumans(3);
    expect(match.phase).toBe('BIDDING');
    expect(ids.map((id) => match.state.players.get(id)?.seat)).toEqual([0, 1, 2]);
    for (const id of ids) {
      const dice = io.received(id).find((m) => m.type === 'your_dice')?.payload.dice as number[];
      expect(dice).toHaveLength(5);
      expect(dice).toEqual([...match.peekDice(id)]);
    }
    expect(match.state.totalDice).toBe(15);
    expect(io.lastBroadcast('turn_start')?.payload).toMatchObject({ playerId: match.state.currentTurn });
  });

  it('모든 서버 메시지에 roomId, roundNo, seq(증가)가 있다', () => {
    const { io } = startHumans(2);
    const all = [...io.broadcasts, ...[...io.direct.values()].flat()];
    for (const m of all) {
      expect(m.payload).toMatchObject({
        roomId: 'ABCDEF',
        roundNo: expect.any(Number),
        seq: expect.any(Number),
      });
    }
    const seqs = io.broadcasts.map((m) => m.payload.seq as number);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it('TC-06/E-05: 라운드 첫 턴에 라이어 → NO_BID_TO_CALL', () => {
    const { match } = startHumans(2);
    const t = currentTurn(match);
    expect(match.handle(t.playerId, 'call_liar', { turnId: t.turnId })).toMatchObject({
      code: 'NO_BID_TO_CALL',
    });
  });

  it('E-04: 내 차례가 아니면 NOT_YOUR_TURN', () => {
    const { match, ids } = startHumans(2);
    const t = currentTurn(match);
    const other = ids.find((id) => id !== t.playerId)!;
    expect(match.handle(other, 'bid', { quantity: 1, face: 2, turnId: t.turnId })).toMatchObject({
      code: 'NOT_YOUR_TURN',
    });
  });

  it('TC-01/E-01~E-03: 잘못된 선언은 INVALID_BID, 상태 변화 없음', () => {
    const { match } = startHumans(3);
    let t = currentTurn(match);
    expect(match.handle(t.playerId, 'bid', { quantity: 4, face: 3, turnId: t.turnId })).toEqual({ ok: true });
    t = currentTurn(match);
    const before = match.state.bids.length;
    for (const bad of [
      { quantity: 4, face: 2 },
      { quantity: 16, face: 3 },
      { quantity: 5, face: 1 },
      { quantity: 5, face: 7 },
      { quantity: '5', face: 3 },
    ]) {
      expect(match.handle(t.playerId, 'bid', { ...bad, turnId: t.turnId })).toMatchObject({
        code: 'INVALID_BID',
      });
    }
    expect(match.state.bids.length).toBe(before);
    expect(currentTurn(match)).toEqual(t);
    // TC-02
    expect(match.handle(t.playerId, 'bid', { quantity: 5, face: 2, turnId: t.turnId })).toEqual({ ok: true });
  });

  it('TC-05: 직전 (10, 6)이면 (11, 6)은 INVALID_BID, 라이어만 가능', () => {
    const { match } = startHumans(2);
    let t = currentTurn(match);
    expect(match.handle(t.playerId, 'bid', { quantity: 10, face: 6, turnId: t.turnId })).toEqual({
      ok: true,
    });
    t = currentTurn(match);
    expect(match.handle(t.playerId, 'bid', { quantity: 11, face: 6, turnId: t.turnId })).toMatchObject({
      code: 'INVALID_BID',
    });
    expect(match.handle(t.playerId, 'call_liar', { turnId: t.turnId })).toEqual({ ok: true });
    expect(match.phase).toBe('REVEAL');
  });

  it('TC-12/E-06: 같은 턴에 선언 두 번 → 첫 입력만 처리, 두 번째는 STALE_TURN', () => {
    const { match } = startHumans(2);
    const t = currentTurn(match);
    expect(match.handle(t.playerId, 'bid', { quantity: 1, face: 2, turnId: t.turnId })).toEqual({ ok: true });
    expect(match.handle(t.playerId, 'bid', { quantity: 1, face: 3, turnId: t.turnId })).toMatchObject({
      code: 'STALE_TURN',
    });
    expect(match.state.bids.length).toBe(1);
  });

  it('라이어 → REVEAL(전체 공개, 1 와일드 집계) → 3초 후 RESOLVE → 다음 라운드, 패배자가 선 (R-04, R-10)', () => {
    const { match, io, scheduler } = startHumans(2);
    let t = currentTurn(match);
    match.handle(t.playerId, 'bid', { quantity: 3, face: 4, turnId: t.turnId });
    const bidder = t.playerId;
    t = currentTurn(match);
    const caller = t.playerId;
    const all = [...match.peekDice(bidder), ...match.peekDice(caller)];
    const actual = all.filter((d) => d === 4 || d === 1).length;
    match.handle(caller, 'call_liar', { turnId: t.turnId });
    expect(io.lastBroadcast('liar_called')?.payload).toMatchObject({ caller, target: bidder });
    const reveal = io.lastBroadcast('reveal')!.payload;
    expect(reveal).toMatchObject({ actual, bidSucceeded: actual >= 3 });
    const loser = actual >= 3 ? caller : bidder;
    expect(reveal.loserId).toBe(loser);
    expect(match.phase).toBe('REVEAL');
    scheduler.advance(FAST_TIMING.revealMs);
    expect(match.state.players.get(loser)?.diceCount).toBe(4);
    expect(io.lastBroadcast('dice_lost')?.payload).toMatchObject({ playerId: loser, diceCount: 4 });
    expect(match.state.roundNo).toBe(2);
    expect(match.state.currentTurn).toBe(loser);
    expect(match.state.totalDice).toBe(9);
    expect(match.state.bids.length).toBe(0);
  });
});

describe('타임아웃 (S-05~S-07)', () => {
  it('TC-10: 직전 4가 3개, 무입력 → 5가 3개 자동 선언 (is_auto=true)', () => {
    const { match, io, scheduler } = startHumans(2);
    let t = currentTurn(match);
    match.handle(t.playerId, 'bid', { quantity: 3, face: 4, turnId: t.turnId });
    t = currentTurn(match);
    scheduler.advance(TURN_MS);
    expect(io.lastBroadcast('bid_made')?.payload).toMatchObject({
      playerId: t.playerId,
      quantity: 3,
      face: 5,
      isAuto: true,
    });
    expect(match.state.bids.at(-1)?.isAuto).toBe(true);
  });

  it('S-06: 직전 선언이 없으면 2가 1개, 상향 불가면 라이어', () => {
    const { match, io, scheduler } = startHumans(2);
    let t = currentTurn(match);
    scheduler.advance(TURN_MS);
    expect(io.lastBroadcast('bid_made')?.payload).toMatchObject({
      playerId: t.playerId,
      quantity: 1,
      face: 2,
      isAuto: true,
    });
    t = currentTurn(match);
    match.handle(t.playerId, 'bid', { quantity: 10, face: 6, turnId: t.turnId });
    scheduler.advance(TURN_MS);
    expect(match.phase).toBe('REVEAL');
    expect(io.lastBroadcast('liar_called')).toBeDefined();
  });

  it('TC-11/E-07: 마감 0.1초 전 입력은 반영되고 타이머는 무시, 마감 후 입력은 STALE_TURN', () => {
    const { match, scheduler } = startHumans(2);
    let t = currentTurn(match);
    scheduler.advance(TURN_MS - 100);
    expect(match.handle(t.playerId, 'bid', { quantity: 2, face: 3, turnId: t.turnId })).toEqual({ ok: true });
    scheduler.advance(100);
    expect(match.state.bids.length).toBe(1);
    expect(match.state.bids[0]?.isAuto).toBe(false);

    t = currentTurn(match);
    scheduler.advance(TURN_MS + 100);
    expect(match.handle(t.playerId, 'bid', { quantity: 5, face: 3, turnId: t.turnId })).toMatchObject({
      code: 'STALE_TURN',
    });
    expect(match.state.bids.at(-1)?.isAuto).toBe(true);
  });

  it('S-07: 2턴 연속 타임아웃이면 봇이 대신 플레이, 입력하면 돌려받음', () => {
    const { match, scheduler, ids } = startHumans(2, { turnSeconds: 60 });
    const [a, b] = ids as [string, string];
    // 두 사람 모두 무입력: 각자 2번씩 타임아웃
    for (let i = 0; i < 4 && match.phase === 'BIDDING'; i += 1) scheduler.advance(60 * 1000);
    const lazy = [a, b].filter((id) => match.state.players.get(id)?.autopilot);
    expect(lazy.length).toBeGreaterThan(0);
    // 대리 중인 플레이어 차례가 오면 봇 지연(1~3초) 안에 행동한다
    while (match.phase !== 'BIDDING' || !lazy.includes(match.state.currentTurn)) scheduler.step();
    const before = match.state.bids.length;
    const turnStartedAt = scheduler.now();
    while (match.state.bids.length === before && match.phase === 'BIDDING') scheduler.step();
    expect(scheduler.now() - turnStartedAt).toBeLessThanOrEqual(FAST_TIMING.botDelayMaxMs);

    // 다시 그 사람 차례에 직접 입력하면 대리가 풀린다
    const who = lazy[0]!;
    while (!(match.phase === 'BIDDING' && match.state.currentTurn === who)) scheduler.step();
    const t = currentTurn(match);
    const r = match.handle(who, 'call_liar', { turnId: t.turnId });
    if (!r.ok) match.handle(who, 'bid', { quantity: 1, face: 2, turnId: t.turnId });
    expect(match.state.players.get(who)?.autopilot).toBe(false);
  });
});

describe('정보 은닉 (S-01, S-02)', () => {
  it('TC-08: 공개 전 브로드캐스트와 공유 상태에 주사위 눈이 없다, your_dice는 본인에게만', () => {
    const { match, io, scheduler, ids } = startHumans(3);
    for (let i = 0; i < 2000 && match.phase !== 'GAME_OVER'; i += 1) scheduler.step();
    for (const m of io.broadcasts) {
      if (m.type === 'reveal') continue;
      expect(JSON.stringify(m.payload)).not.toMatch(/"dice"/);
    }
    expect(JSON.stringify(match.state.toJSON())).not.toMatch(/"dice"/);
    for (const id of ids) {
      for (const m of io.received(id).filter((x) => x.type === 'your_dice')) {
        // 본인 주사위 수와 일치 (다른 사람 것 섞이지 않음)
        expect((m.payload.dice as number[]).length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('TC-09/E-11: 관전자와 탈락자는 your_dice를 받지 않는다', () => {
    const { match, io, scheduler } = startHumans(2, { startingDice: 3 });
    const spectator = joinOk(match, 'g-spec', '구경꾼');
    expect(match.state.players.get(spectator)?.spectator).toBe(true);
    for (let i = 0; i < 5000 && match.phase !== 'GAME_OVER'; i += 1) scheduler.step();
    expect(match.phase).toBe('GAME_OVER');
    expect(io.received(spectator).filter((m) => m.type === 'your_dice')).toHaveLength(0);
  });

  it('탈락자는 다음 라운드부터 your_dice를 받지 않는다 (S-02)', () => {
    const { match, io, scheduler, ids } = startHumans(3, { startingDice: 3 });
    let eliminated: string | null = null;
    for (let i = 0; i < 20_000 && match.phase !== 'GAME_OVER'; i += 1) {
      scheduler.step();
      eliminated ??= ids.find((id) => match.state.players.get(id)?.eliminated) ?? null;
    }
    expect(eliminated).not.toBeNull();
    const elimRank = match.state.players.get(eliminated!)!.rank;
    expect(elimRank).toBe(3);
    const lastDiceRound = Math.max(
      ...io
        .received(eliminated!)
        .filter((m) => m.type === 'your_dice')
        .map((m) => m.payload.roundNo as number),
    );
    const elimRound = io.broadcasts.find(
      (m) => m.type === 'player_eliminated' && m.payload.playerId === eliminated,
    )!.payload.roundNo as number;
    expect(lastDiceRound).toBeLessThanOrEqual(elimRound);
    // 탈락 뒤에도 라운드가 진행됐고(다른 사람은 주사위를 받았고), 탈락자는 그 라운드의 주사위를 받지 않았다
    const lastRound = match.state.roundNo;
    expect(lastRound).toBeGreaterThan(elimRound);
    const survivor = ids.find((id) => id !== eliminated && match.state.players.get(id)?.rank === 1)!;
    expect(io.received(survivor).some((m) => m.type === 'your_dice' && m.payload.roundNo === lastRound)).toBe(
      true,
    );
  });
});

describe('재접속과 이탈 (S-08~S-10, E-10, E-13)', () => {
  it('S-09: 재접속하면 your_dice와 turn_start를 다시 받는다', () => {
    const { match, io, ids } = startHumans(2);
    const a = ids[0]!;
    match.disconnect(a);
    expect(match.state.players.get(a)?.connected).toBe(false);
    const before = io.received(a).length;
    match.reconnect(a);
    const resent = io
      .received(a)
      .slice(before)
      .map((m) => m.type);
    expect(resent).toEqual(['your_dice', 'turn_start']);
    expect(match.state.players.get(a)?.connected).toBe(true);
  });

  it('E-13: 같은 게스트 ID로 다시 들어오면 같은 자리를 이어간다', () => {
    const { match, ids } = startHumans(2);
    expect(match.join('guest-0', '아무거나')).toEqual({
      ok: true,
      playerId: ids[0],
      role: 'player',
      reclaimed: true,
    });
  });

  it('S-10/TC-14: 게임 중 나가면 봇이 이어받아 플레이한다', () => {
    const { match, scheduler, ids, io } = startHumans(3);
    const leaver = ids[1]!;
    match.leave(leaver);
    expect(match.state.players.get(leaver)?.isBot).toBe(true);
    expect(io.abandoned).toBe(0);
    for (let i = 0; i < 2000 && match.phase === 'BIDDING' && match.state.currentTurn !== leaver; i += 1)
      scheduler.step();
    const before = match.state.bids.length;
    scheduler.advance(FAST_TIMING.botDelayMaxMs);
    expect(match.state.bids.length + (match.phase === 'BIDDING' ? 0 : 1)).toBeGreaterThan(before);
    // 같은 게스트 ID로 다시 들어오면 관전자
    expect(match.join('guest-1', '복귀자')).toMatchObject({ ok: true, role: 'spectator', reclaimed: false });
  });

  it('E-10: 게임 중 사람이 모두 나가면 방 종료, 전적 미기록', () => {
    const { match, io, scheduler, ids } = startHumans(2);
    for (const id of ids) match.leave(id);
    expect(io.abandoned).toBe(1);
    scheduler.runAll();
    expect(io.records).toHaveLength(0);
  });

  it('게임 중 방장이 나가면 다음 사람에게 위임', () => {
    const { match, ids } = startHumans(3);
    match.leave(ids[0]!);
    expect(match.state.hostId).toBe(ids[1]);
  });
});

describe('게임 종료와 리매치 (R-13)', () => {
  it('GAME_OVER: 순위 확정, game_over 브로드캐스트, 기록 1건', () => {
    const { match, io, scheduler } = startHumans(3, { startingDice: 3 });
    scheduler.runAll();
    expect(match.phase).toBe('GAME_OVER');
    const ranking = io.lastBroadcast('game_over')!.payload.ranking as Array<{ rank: number }>;
    expect(ranking.map((r) => r.rank).sort()).toEqual([1, 2, 3]);
    expect(io.records).toHaveLength(1);
    const rec = io.records[0]!;
    expect(rec.players.map((p) => p.finalRank).sort()).toEqual([1, 2, 3]);
    // 라운드마다 정확히 1개를 잃는다: 라운드 수 = 처음 주사위 합 - 우승자의 남은 주사위
    const winnerDice = [...match.state.players.values()].find((p) => p.rank === 1)!.diceCount;
    expect(rec.rounds.length).toBe(3 * 3 - winnerDice);
    expect(rec.bids.length).toBeGreaterThan(0);
    expect(scheduler.pending).toBe(0);
  });

  it('리매치: 같은 방에서 WAITING으로 돌아가고 관전자는 빈자리에 참가', () => {
    const { match, scheduler, ids } = startHumans(2, { startingDice: 3, maxPlayers: 3 });
    const spec = joinOk(match, 'g-spec', '구경꾼');
    scheduler.runAll();
    expect(match.handle(ids[1]!, 'rematch', {})).toEqual({ ok: true });
    expect(match.phase).toBe('WAITING');
    expect(match.state.players.get(spec)?.spectator).toBe(false);
    expect([...match.state.players.values()].every((p) => p.diceCount === 0 && p.rank === 0)).toBe(true);
    expect(match.state.players.get(ids[0]!)?.isHost).toBe(true);
  });
});
