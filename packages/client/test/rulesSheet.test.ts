import { countFace, DEFAULT_ROOM_OPTIONS } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { RULE_STEPS, WILD_EXAMPLE } from '../src/screens/rulesSheet.js';

describe('게임 규칙 시트', () => {
  it('R-09: 와일드 예시가 룰 엔진의 개수 세기와 같다 (선언 성공)', () => {
    const { bid, dice } = WILD_EXAMPLE;
    const actual = countFace([dice], bid.face);
    expect(actual).toBe(4);
    expect(actual).toBeGreaterThanOrEqual(bid.quantity);
  });

  it('명세의 핵심 규칙을 모두 설명한다', () => {
    const covered = new Set(RULE_STEPS.flatMap((s) => s.spec));
    for (const id of [
      'R-01',
      'R-04',
      'R-05',
      'R-06',
      'R-07',
      'R-08',
      'R-09',
      'R-10',
      'R-11',
      'R-12',
      'R-13',
      'S-06',
      'S-07',
    ])
      expect(covered, id).toContain(id);
  });

  it('턴 시간은 방 옵션 기본값을 그대로 쓴다', () => {
    const timing = RULE_STEPS.find((s) => s.spec.includes('S-06'));
    expect(timing?.body).toContain(`${DEFAULT_ROOM_OPTIONS.turnSeconds}초`);
  });
});
