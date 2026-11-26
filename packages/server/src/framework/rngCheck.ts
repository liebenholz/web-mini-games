import { bulls, oneCard } from '@wmg/rules';
import { chiSquareUniform, type ChiSquareResult } from './chiSquare.js';
import { rollDie, shuffle, type Rng } from './rng.js';

/**
 * 난수 분포 검증 (TC-15, S-03). 게임이 쓰는 함수 그대로 n번 뽑아 카이제곱 검정을 한다.
 * 여러 검정을 한 번에 하므로 전체 유의수준을 검정 수로 나눈다 (본페로니).
 */
export interface RngCheck extends ChiSquareResult {
  readonly id: string;
  readonly label: string;
  readonly samples: number;
  readonly bins: number;
}

export interface RngCheckReport {
  readonly samples: number;
  readonly alpha: number;
  /** 검정 하나당 기준 = alpha / 검정 수 */
  readonly perTestAlpha: number;
  readonly checks: readonly RngCheck[];
  readonly passed: boolean;
}

function check(id: string, label: string, counts: number[], samples: number): RngCheck {
  return { id, label, samples, bins: counts.length, ...chiSquareUniform(counts) };
}

export function runRngChecks(rng: Rng, n = 100_000, alpha = 0.01): RngCheckReport {
  const checks: RngCheck[] = [];

  // TC-15: 주사위 눈 (거짓말쟁이 주사위 S-03)
  const faces = new Array<number>(6).fill(0);
  const pairs = new Array<number>(36).fill(0);
  let prev = 0;
  for (let i = 0; i < n; i += 1) {
    const f = rollDie(rng);
    faces[f - 1] = (faces[f - 1] ?? 0) + 1;
    // 연달아 굴린 두 눈이 서로 영향을 주지 않는지 (겹치지 않는 쌍)
    if (i % 2 === 1) pairs[(prev - 1) * 6 + (f - 1)] = (pairs[(prev - 1) * 6 + (f - 1)] ?? 0) + 1;
    prev = f;
  }
  checks.push(check('dice-face', '주사위 눈 1~6 (TC-15)', faces, n));
  checks.push(check('dice-pair', '연달아 굴린 두 눈 36가지', pairs, Math.floor(n / 2)));

  // 첫 선·흑 정하기: 2~6명 중 하나 (R-03, 오목 무작위 흑, 숫자야구 선공)
  for (let k = 2; k <= 6; k += 1) {
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i += 1) {
      const v = rng.int(k);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    checks.push(check(`pick-${k}`, `${k}명 중 한 명 고르기`, counts, n));
  }

  // 원카드 덱 섞기: 맨 위에 오는 카드, 첫 카드가 가는 자리 (54장)
  const deck = oneCard.fullDeck();
  const top = new Array<number>(deck.length).fill(0);
  const where = new Array<number>(deck.length).fill(0);
  const shuffles = Math.floor(n / 2);
  for (let i = 0; i < shuffles; i += 1) {
    const s = shuffle(deck, rng);
    const t = deck.indexOf(s[0] as string);
    top[t] = (top[t] ?? 0) + 1;
    const w = s.indexOf(deck[0] as string);
    where[w] = (where[w] ?? 0) + 1;
  }
  checks.push(check('shuffle-top', `원카드 섞은 뒤 맨 위 카드 (${deck.length}장)`, top, shuffles));
  checks.push(check('shuffle-place', `원카드 첫 카드가 가는 자리 (${deck.length}자리)`, where, shuffles));

  // 숫자야구 비밀 숫자 4자리: 자리마다 0~9 (B-30)
  const digits = new Array<number>(40).fill(0);
  const secrets = Math.floor(n / 4);
  for (let i = 0; i < secrets; i += 1) {
    const s = bulls.randomNumber(4, (m) => rng.int(m));
    for (let p = 0; p < 4; p += 1) {
      const idx = p * 10 + Number(s[p]);
      digits[idx] = (digits[idx] ?? 0) + 1;
    }
  }
  checks.push(check('bulls-digits', '숫자야구 비밀 숫자 자리별 0~9 (4자리)', digits, secrets));

  const perTestAlpha = alpha / checks.length;
  return {
    samples: n,
    alpha,
    perTestAlpha,
    checks,
    passed: checks.every((c) => c.pValue >= perTestAlpha),
  };
}
