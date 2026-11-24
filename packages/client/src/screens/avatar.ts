import { h, svg } from '../dom.js';
import { icons } from '../icons.js';
/** 아바타에 필요한 공개 정보 */
interface AvatarPlayer {
  readonly nickname: string;
  readonly isBot: boolean;
}

/** 좌석 순서로 파스텔 톤 1~6을 돌려쓴다 (테이블 캔버스와 같은 순서) */
export function toneFor(index: number): number {
  return (((index % 6) + 6) % 6) + 1;
}

/** 닉네임 첫 글자 또는 봇 아이콘을 파스텔 원에 담는다. 이름은 옆에 따로 적으므로 스크린리더에서는 숨긴다 */
export function avatar(p: AvatarPlayer, index: number): HTMLElement {
  const first = [...p.nickname.trim()][0] ?? '?';
  return h(
    'span',
    { class: `avatar tone-${toneFor(index)}`, 'aria-hidden': 'true' },
    p.isBot ? svg(icons.bot) : first.toUpperCase(),
  );
}
