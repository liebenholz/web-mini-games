/** 게임 서버 주소. 빌드 시 VITE_SERVER_URL로 주입한다 (예: wss://api.example.com) */
export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`;
