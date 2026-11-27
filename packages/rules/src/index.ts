export * from './types.js';
export * from './bid.js';
export * from './table.js';
export * from './bot.js';
export * from './room.js';
export * from './protocol.js';

/** 오목 룰 엔진 (docs/specs/gomoku.md). 이름이 겹치지 않게 네임스페이스로 내보낸다: gomoku.checkPlace(...) */
export * as gomoku from './games/gomoku/index.js';

/** 원카드 룰 엔진 (docs/specs/one-card.md): oneCard.playCard(...) */
export * as oneCard from './games/one-card/index.js';

/** 숫자야구 룰 엔진 (docs/specs/bulls-and-cows.md): bulls.score(...) */
export * as bulls from './games/bulls-and-cows/index.js';

/** 리버시 룰 엔진 (docs/specs/reversi.md): reversi.placeStone(...) */
export * as reversi from './games/reversi/index.js';

/** 업다운 숫자폭탄 룰 엔진 (docs/specs/updown-bomb.md): updown.callNumber(...) */
export * as updown from './games/updown-bomb/index.js';
export * from './stats.js';
export * from './clientErrors.js';
