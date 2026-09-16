export { GameRoom } from './room.js';

/** 룸 이름 정규화 — DO 키에 임의 문자열이 들어가지 않게 한다 */
function normalizeRoom(raw) {
  const s = String(raw ?? 'main').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  return s || 'main';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('WebSocket 연결이 필요합니다.', { status: 426 });
      }
      const room = normalizeRoom(url.searchParams.get('room'));
      const id = env.GAME_ROOM.idFromName(room);
      return env.GAME_ROOM.get(id).fetch(request);
    }

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }

    // 그 외는 전부 정적 에셋 (public/)
    return env.ASSETS.fetch(request);
  },
};
