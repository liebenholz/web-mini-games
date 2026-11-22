import * as Phaser from 'phaser';
import type { DieFace } from '@wmg/rules';
import type { BidView, PlayerView, RevealView } from '../net.js';

/** Phaser 테이블에 넘기는 공개 정보 + 내 주사위. 다른 사람의 눈은 reveal이 온 뒤에만 들어온다 (S-01). */
export interface TableModel {
  readonly phase: string;
  readonly me: string;
  readonly players: readonly PlayerView[];
  readonly myDice: readonly DieFace[];
  readonly currentTurn: string;
  readonly deadline: number;
  readonly turnMs: number;
  readonly bids: readonly BidView[];
  readonly reveal: RevealView | null;
  readonly roundNo: number;
  readonly serverNow: () => number;
}

interface Tone {
  bg: number;
  fg: number;
  fgCss: string;
}

interface Palette {
  surface: number;
  bg: number;
  line: number;
  lineStrong: number;
  ink: number;
  accent: number;
  accentSoft: number;
  danger: number;
  tones: Tone[];
  css: { ink: string; ink2: string; ink3: string; accent: string; danger: string; success: string };
}

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.25, 0.25],
    [0.5, 0.5],
    [0.75, 0.75],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  6: [
    [0.3, 0.22],
    [0.7, 0.22],
    [0.3, 0.5],
    [0.7, 0.5],
    [0.3, 0.78],
    [0.7, 0.78],
  ],
};

const FONT = '"Pretendard Variable", Pretendard, sans-serif';

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim() || '#000000';
  const c = (name: string) => Phaser.Display.Color.HexStringToColor(v(name)).color;
  return {
    surface: c('--surface'),
    bg: c('--bg'),
    line: c('--line'),
    lineStrong: c('--line-strong'),
    ink: c('--ink'),
    accent: c('--accent'),
    accentSoft: c('--accent-soft'),
    danger: c('--danger'),
    tones: [1, 2, 3, 4, 5, 6].map((i) => ({
      bg: c(`--p${i}-bg`),
      fg: c(`--p${i}-fg`),
      fgCss: v(`--p${i}-fg`),
    })),
    css: {
      ink: v('--ink'),
      ink2: v('--ink-2'),
      ink3: v('--ink-3'),
      accent: v('--accent'),
      danger: v('--danger'),
      success: v('--success'),
    },
  };
}

interface SeatSpot {
  readonly player: PlayerView;
  readonly x: number;
  readonly y: number;
  /** 타이머 링을 두를 아바타 중심과 반지름 */
  readonly ring: { x: number; y: number; r: number } | null;
}

/**
 * 게임 테이블 (명세 8장): 좌석, 남은 주사위 수, 차례, 내 주사위, 현재 선언과 기록, 턴 타이머, 공개 연출.
 * 상태가 바뀔 때마다 다시 그린다. 공개 연출만 라운드마다 한 번 애니메이션한다.
 */
export class TableScene extends Phaser.Scene {
  #model: TableModel | null = null;
  #palette!: Palette;
  #timer!: Phaser.GameObjects.Graphics;
  #layer!: Phaser.GameObjects.Container;
  #spots = new Map<string, SeatSpot>();
  #animatedReveal = '';
  #reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    super('table');
  }

  create(): void {
    this.#palette = readPalette();
    this.cameras.main.setBackgroundColor(this.#palette.surface);
    this.#layer = this.add.container(0, 0);
    this.#timer = this.add.graphics();
    this.scale.on('resize', () => this.#redraw());
    this.#redraw();
  }

  setModel(model: TableModel): void {
    this.#model = model;
    if (this.#layer) this.#redraw();
  }

  override update(): void {
    const m = this.#model;
    const g = this.#timer;
    g.clear();
    if (!m || m.phase !== 'BIDDING' || !m.currentTurn) return;
    const spot = this.#spots.get(m.currentTurn);
    if (!spot?.ring) return; // 내 차례 타이머는 DOM 패널에 있다
    const left = Math.max(0, m.deadline - m.serverNow());
    const ratio = m.turnMs > 0 ? left / m.turnMs : 0;
    const { x, y, r } = spot.ring;
    g.lineStyle(4, this.#palette.line, 1);
    g.strokeCircle(x, y, r);
    g.lineStyle(4, left <= 5000 ? this.#palette.danger : this.#palette.accent, 1);
    g.beginPath();
    g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
    g.strokePath();
  }

  #redraw(): void {
    const m = this.#model;
    // 지울 객체를 가리키는 진행 중 트윈을 먼저 멈춘다 (공개 중 상태가 바뀌면 최종 모습으로 다시 그린다)
    this.tweens.killAll();
    this.#layer.removeAll(true);
    this.#spots.clear();
    if (!m) return;
    const { width: W, height: H } = this.scale;
    const seated = m.players.filter((x) => !x.spectator).sort((a, b) => a.seat - b.seat);
    const toneIndex = new Map(seated.map((p, i) => [p.id, i]));
    const meIndex = seated.findIndex((x) => x.id === m.me);
    // 나를 기준으로 시계 방향 순서가 보이게 돌려 놓는다 (R-02)
    const others = meIndex >= 0 ? [...seated.slice(meIndex + 1), ...seated.slice(0, meIndex)] : seated;

    const compact = W < 520;
    const cx = W / 2;
    const cy = H * (compact ? 0.42 : 0.44);
    const rx = W * (compact ? 0.38 : 0.36);
    const ry = H * (compact ? 0.3 : 0.32);
    const n = others.length;
    const slotWidth = n <= 1 ? W * 0.6 : Math.min(160, (W - 24) / Math.min(n, compact ? 3 : 5));
    others.forEach((player, i) => {
      // 위쪽 반원에 고르게 (왼쪽 아래 → 위 → 오른쪽 아래)
      const t = n === 1 ? 0.5 : i / (n - 1);
      const angle = Math.PI * (1.05 - 1.1 * t);
      // 공개 때 주사위 줄(최대 5개)이 화면 밖으로 나가지 않게 가장자리를 막는다
      const margin = compact ? 54 : 70;
      const x = Math.min(W - margin, Math.max(margin, cx + Math.cos(angle) * rx));
      const y = cy - Math.sin(angle) * ry;
      this.#drawSeat(player, x, y, toneIndex.get(player.id) ?? 0, slotWidth, m, compact);
    });

    const revealKey = m.reveal ? `${m.roundNo}:${m.reveal.loserId}` : '';
    const animate = revealKey !== '' && revealKey !== this.#animatedReveal && !this.#reduceMotion;
    if (revealKey) this.#animatedReveal = revealKey;

    this.#drawCenter(cx, cy, m, compact, animate);
    this.#drawMine(W, H, m, compact, animate);
  }

  #text(
    x: number,
    y: number,
    text: string,
    size: number,
    color: string,
    weight = 600,
    maxWidth = 0,
  ): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      fontStyle: String(weight),
      color,
      align: 'center',
    });
    t.setOrigin(0.5, 0.5);
    t.setResolution(Math.min(3, window.devicePixelRatio || 1));
    // 캔버스는 줄바꿈이 없으므로 폭을 넘으면 말줄임한다. 전체 이름은 DOM(결과 화면, 스크린리더 요약)에 있다
    if (maxWidth > 0 && t.width > maxWidth) {
      const chars = [...text];
      while (chars.length > 1 && t.width > maxWidth) {
        chars.pop();
        t.setText(`${chars.join('')}…`);
      }
    }
    this.#layer.add(t);
    return t;
  }

  #die(
    x: number,
    y: number,
    size: number,
    face: DieFace | 0,
    highlight: boolean,
  ): Phaser.GameObjects.Graphics {
    const p = this.#palette;
    const g = this.add.graphics({ x, y });
    const half = size / 2;
    const radius = size * 0.22;
    if (face === 0) {
      // 숨겨진 주사위: 파스텔 블록
      g.fillStyle(p.lineStrong, 1);
      g.fillRoundedRect(-half, -half, size, size, radius);
    } else {
      g.fillStyle(highlight ? p.accent : p.bg, 1);
      g.fillRoundedRect(-half, -half, size, size, radius);
      g.lineStyle(Math.max(1, size / 24), highlight ? p.accent : p.lineStrong, 1);
      g.strokeRoundedRect(-half, -half, size, size, radius);
      g.fillStyle(highlight ? p.bg : p.ink, 1);
      for (const [px, py] of PIPS[face] ?? [])
        g.fillCircle(-half + px * size, -half + py * size, size * 0.09);
    }
    this.#layer.add(g);
    return g;
  }

  #avatar(x: number, y: number, r: number, player: PlayerView, tone: Tone, dim: boolean): void {
    const g = this.add.graphics({ x, y });
    g.fillStyle(tone.bg, dim ? 0.5 : 1);
    g.fillCircle(0, 0, r);
    this.#layer.add(g);
    const label =
      player.isBot && player.nickname.startsWith('봇')
        ? player.nickname.replace(/\D+/g, '') || '봇'
        : ([...player.nickname.trim()][0] ?? '?');
    const t = this.#text(x, y + 1, label, Math.round(r * 0.85), tone.fgCss, 800);
    if (dim) t.setAlpha(0.5);
  }

  #drawSeat(
    player: PlayerView,
    x: number,
    y: number,
    index: number,
    slotWidth: number,
    m: TableModel,
    compact: boolean,
  ): void {
    const p = this.#palette;
    const tone = p.tones[index % 6] ?? { bg: p.surface, fg: p.ink, fgCss: p.css.ink };
    const active = m.currentTurn === player.id && m.phase === 'BIDDING';
    const r = compact ? 17 : 20;
    const avatarY = y - (compact ? 22 : 26);
    this.#avatar(x, avatarY, r, player, tone, player.eliminated);
    this.#spots.set(player.id, { player, x, y, ring: { x, y: avatarY, r: r + 5 } });

    const nameColor = player.eliminated ? p.css.ink3 : active ? p.css.accent : p.css.ink;
    const name = this.#text(x, y + 6, player.nickname, compact ? 13 : 15, nameColor, 700, slotWidth - 8);
    if (player.eliminated) {
      const strike = this.add.graphics();
      strike.lineStyle(1.5, p.lineStrong, 1);
      strike.lineBetween(x - name.width / 2 - 2, y + 6, x + name.width / 2 + 2, y + 6);
      this.#layer.add(strike);
    }
    // 처음부터 봇이면 이름이 "봇 N"이다. 이탈해 봇이 이어받은 사람과 자동 진행만 표시한다 (S-07, S-10)
    const replaced = player.isBot && !player.nickname.startsWith('봇');
    const tags = [
      replaced ? '봇이 대신' : '',
      player.autopilot ? '자동' : '',
      !player.connected && !player.isBot ? '끊김' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (tags) this.#text(x, y + 22, tags, 11, p.css.ink3, 600, slotWidth);

    const rowY = y + (tags ? 40 : 26);
    const revealed = m.reveal?.dice.find((d) => d.playerId === player.id);
    if (revealed) {
      const size = compact ? 16 : 20;
      const gap = 3;
      const total = revealed.dice.length * (size + gap) - gap;
      revealed.dice.forEach((face, i) => {
        const hit = face === m.reveal?.bid.face || face === 1;
        this.#die(x - total / 2 + size / 2 + i * (size + gap), rowY + 2, size, face, hit);
      });
    } else if (!player.eliminated) {
      const size = compact ? 9 : 11;
      const gap = 3;
      const total = player.diceCount * (size + gap) - gap;
      for (let i = 0; i < player.diceCount; i += 1)
        this.#die(x - total / 2 + size / 2 + i * (size + gap), rowY, size, 0, false);
    } else if (player.rank > 0) {
      this.#text(x, rowY, `${player.rank}위`, 12, p.css.ink3, 700);
    }

    if (m.reveal && m.reveal.loserId === player.id) this.#stamp(x + r + 14, avatarY - 4, compact);
  }

  /** 패배 표시: 코랄 알약 배지 */
  #stamp(x: number, y: number, compact: boolean): void {
    const p = this.#palette;
    const w = compact ? 38 : 44;
    const hgt = compact ? 22 : 26;
    const g = this.add.graphics({ x, y });
    g.fillStyle(p.danger, 1);
    g.fillRoundedRect(-w / 2, -hgt / 2, w, hgt, hgt / 2);
    this.#layer.add(g);
    const t = this.#text(x, y, '-1', compact ? 13 : 15, '#ffffff', 800);
    if (!this.#reduceMotion) {
      for (const o of [g, t]) {
        o.setScale(0.4);
        o.setAlpha(0);
        this.tweens.add({ targets: o, scale: 1, alpha: 1, duration: 320, delay: 1100, ease: 'Back.easeOut' });
      }
    }
  }

  #drawCenter(cx: number, cy: number, m: TableModel, compact: boolean, animate: boolean): void {
    const p = this.#palette;
    if (m.reveal) {
      const r = m.reveal;
      this.#text(
        cx,
        cy - (compact ? 38 : 48),
        `${r.bid.quantity}개 × ${r.bid.face} 선언`,
        compact ? 13 : 15,
        p.css.ink2,
        600,
      );
      const count = this.#text(
        cx,
        cy,
        '0',
        compact ? 52 : 64,
        r.bidSucceeded ? p.css.accent : p.css.danger,
        800,
      );
      const verdict = this.#text(
        cx,
        cy + (compact ? 40 : 50),
        r.bidSucceeded ? '선언 성공' : '거짓말!',
        compact ? 15 : 17,
        r.bidSucceeded ? p.css.success : p.css.danger,
        800,
      );
      if (animate) {
        verdict.setAlpha(0);
        const counter = { v: 0 };
        this.tweens.add({
          targets: counter,
          v: r.actual,
          duration: 900,
          ease: 'Cubic.easeOut',
          onUpdate: () => count.setText(String(Math.round(counter.v))),
          onComplete: () => count.setText(String(r.actual)),
        });
        this.tweens.add({ targets: verdict, alpha: 1, duration: 200, delay: 950 });
      } else {
        count.setText(String(r.actual));
      }
      return;
    }

    const last = m.bids.at(-1);
    if (!last) {
      if (m.phase === 'BIDDING') {
        const starter = m.players.find((x) => x.id === m.currentTurn);
        this.#text(
          cx,
          cy,
          starter?.id === m.me ? '첫 선언을 하세요' : `${starter?.nickname ?? ''} 님이 첫 선언`,
          compact ? 15 : 17,
          p.css.ink2,
          600,
          this.scale.width * 0.6,
        );
      } else if (m.phase === 'STARTING') {
        this.#text(cx, cy, '곧 시작합니다', compact ? 18 : 22, p.css.accent, 800);
      }
      return;
    }

    // 현재 선언 카드
    const cardW = compact ? 150 : 190;
    const cardH = compact ? 86 : 104;
    const card = this.add.graphics({ x: cx, y: cy });
    card.fillStyle(p.bg, 1);
    card.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 18);
    card.lineStyle(1, p.line, 1);
    card.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 18);
    this.#layer.add(card);

    const bidder = m.players.find((x) => x.id === last.playerId);
    const who = `${bidder?.id === m.me ? '나' : (bidder?.nickname ?? '')}${last.isAuto ? ' · 자동' : ''}`;
    this.#text(cx, cy - cardH / 2 + 16, who, compact ? 12 : 13, p.css.ink3, 600, cardW - 20);
    const size = compact ? 36 : 44;
    const qty = this.#text(cx - size * 0.6, cy + 8, String(last.quantity), compact ? 40 : 50, p.css.ink, 800);
    this.#text(qty.x + qty.width / 2 + 10, cy + 10, '×', compact ? 16 : 20, p.css.ink3, 600);
    this.#die(qty.x + qty.width / 2 + 24 + size / 2, cy + 8, size, last.face as DieFace, false);
    // 선언 기록 (최근 5개)
    const trail = m.bids
      .slice(-6, -1)
      .map((b) => `${b.quantity}×${b.face}`)
      .join('  ·  ');
    if (trail)
      this.#text(cx, cy + cardH / 2 + 18, trail, compact ? 12 : 13, p.css.ink3, 600, this.scale.width - 32);
  }

  #drawMine(W: number, H: number, m: TableModel, compact: boolean, animate: boolean): void {
    const p = this.#palette;
    const me = m.players.find((x) => x.id === m.me);
    const y = H - (compact ? 38 : 50);
    if (!me || me.spectator) {
      this.#text(W / 2, y, '관전 중', 15, p.css.ink3, 700);
      return;
    }
    if (me.eliminated) {
      this.#text(W / 2, y, me.rank > 0 ? `탈락 · ${me.rank}위` : '탈락', 15, p.css.ink3, 700);
      return;
    }
    this.#spots.set(me.id, { player: me, x: W / 2, y, ring: null });
    const revealed = m.reveal?.dice.find((d) => d.playerId === me.id)?.dice;
    const dice = revealed ?? m.myDice;
    const size = compact ? 40 : 48;
    const gap = compact ? 8 : 10;
    const count = dice.length || me.diceCount;
    const total = count * (size + gap) - gap;

    // 내 주사위 받침
    const tray = this.add.graphics({ x: W / 2, y });
    const trayW = total + 28;
    const trayH = size + 24;
    tray.fillStyle(p.bg, 1);
    tray.fillRoundedRect(-trayW / 2, -trayH / 2, trayW, trayH, 18);
    tray.lineStyle(1, p.line, 1);
    tray.strokeRoundedRect(-trayW / 2, -trayH / 2, trayW, trayH, 18);
    this.#layer.add(tray);

    if (dice.length > 0) {
      dice.forEach((face, i) => {
        const hit = Boolean(m.reveal) && (face === m.reveal?.bid.face || face === 1);
        const d = this.#die(W / 2 - total / 2 + size / 2 + i * (size + gap), y, size, face, hit);
        if (animate && hit) {
          d.setScale(0.8);
          this.tweens.add({ targets: d, scale: 1, duration: 300, delay: 300 + i * 60, ease: 'Back.easeOut' });
        }
      });
    } else if (m.phase !== 'GAME_OVER') {
      for (let i = 0; i < me.diceCount; i += 1)
        this.#die(W / 2 - total / 2 + size / 2 + i * (size + gap), y, size, 0, false);
    }
    if (m.reveal && m.reveal.loserId === me.id) this.#stamp(W / 2 + trayW / 2 - 6, y - trayH / 2, compact);
    const active = m.currentTurn === me.id && m.phase === 'BIDDING';
    this.#text(
      W / 2,
      y - trayH / 2 - 12,
      active ? '내 차례' : '내 주사위',
      12,
      active ? p.css.accent : p.css.ink3,
      700,
    );
  }
}

/** Phaser 게임을 parent 안에 띄운다. 폰트가 준비된 뒤에 그려야 글자가 대체 폰트로 굳지 않는다 */
export async function mountTable(parent: HTMLElement): Promise<{ scene: TableScene; destroy: () => void }> {
  await Promise.all([
    document.fonts.load('600 16px "Pretendard Variable"', '가나다123'),
    document.fonts.load('800 32px "Pretendard Variable"', '가나다123'),
  ]).catch(() => undefined);
  const scene = new TableScene();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    transparent: false,
    banner: false,
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth, height: parent.clientHeight },
    render: { antialias: true, roundPixels: false },
    scene,
  });
  await new Promise<void>((resolve) => game.events.once(Phaser.Core.Events.READY, () => resolve()));
  return { scene, destroy: () => game.destroy(true) };
}
