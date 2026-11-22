/**
 * 이름 뒤에 붙는 주격 조사 "이/가"를 고른다. 닉네임은 사용자가 정하므로 끝 글자로 판단한다.
 * - 한글: 받침이 있으면 "이", 없으면 "가"
 * - 숫자: 읽는 소리로 판단 (예: "봇 2" → 이 → "가", "봇 3" → 삼 → "이")
 * - 영문: l, m, n, r로 끝나면 받침이 있는 것으로 본다 (Tom → 톰)
 * - 그 밖의 글자: 판단할 수 없으므로 "이(가)"
 */
const DIGIT_HAS_FINAL: Record<string, boolean> = {
  '0': true, // 영
  '1': true, // 일
  '2': false, // 이
  '3': true, // 삼
  '4': false, // 사
  '5': false, // 오
  '6': true, // 육
  '7': true, // 칠
  '8': true, // 팔
  '9': false, // 구
};

function hasFinalConsonant(word: string): boolean | null {
  const last = [...word.trim()].at(-1);
  if (!last) return null;
  const code = last.codePointAt(0) ?? 0;
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (last in DIGIT_HAS_FINAL) return DIGIT_HAS_FINAL[last] ?? null;
  if (/[a-z]/i.test(last)) return 'lmnr'.includes(last.toLowerCase());
  return null;
}

/** "봇 2" → "봇 2가", "민준" → "민준이" */
export function withSubject(word: string): string {
  const final = hasFinalConsonant(word);
  if (final === null) return `${word}이(가)`;
  return `${word}${final ? '이' : '가'}`;
}
