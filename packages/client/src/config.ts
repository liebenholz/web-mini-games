/**
 * 게임 서버 주소. 빌드 시 VITE_SERVER_URL로 주입한다 (예: wss://api.example.com).
 * 없으면 페이지와 같은 호스트의 2567 포트. 처음 연결할 때 읽는다 (모듈을 불러오기만 해도 location을 건드리지 않게)
 */
export function serverUrl(): string {
  return (
    (import.meta.env.VITE_SERVER_URL as string | undefined) ??
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`
  );
}
