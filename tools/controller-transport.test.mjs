import { test, expect } from 'bun:test';
const url = process.env.JESTEROS_CONTROL_TEST_URL;
function peer() {
  const socket = new WebSocket(url), queued = [], waiters = [];
  socket.onmessage = ({ data }) => { const value = JSON.parse(data); const resolve = waiters.shift(); if (resolve) resolve(value); else queued.push(value); };
  const ready = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  return { socket, ready, send: value => socket.send(JSON.stringify(value)), next: () => queued.length ? Promise.resolve(queued.shift()) : new Promise(resolve => waiters.push(resolve)) };
}
test.skipIf(!url)('relay pairs one operator, preserves cue/result IDs, isolates screens and releases disconnected operators', async () => {
  const screen = peer(), operator = peer(), stranger = peer(), other = peer();
  try {
    await Promise.all([screen.ready, operator.ready, stranger.ready, other.ready]);
    screen.send({ type: 'register' }); const { code } = await screen.next();
    other.send({ type: 'register' }); const otherCode = (await other.next()).code;
    expect(code).not.toBe(otherCode);
    operator.send({ type: 'pair', code }); expect((await operator.next()).type).toBe('paired'); expect((await screen.next()).type).toBe('paired');
    stranger.send({ type: 'pair', code }); expect((await stranger.next()).type).toBe('error');
    const cue = { type: 'cue', id: 'cue-123', text: 'Transport test', windowId: 'messages', conversationId: 'casey' };
    operator.send(cue); expect(await screen.next()).toEqual(cue);
    screen.send({ type: 'result', id: cue.id, result: { status: 'applied' } }); expect((await operator.next()).id).toBe(cue.id);
    operator.socket.close(); expect((await screen.next()).type).toBe('disconnected');
    stranger.send({ type: 'pair', code }); expect((await stranger.next()).type).toBe('paired'); expect((await screen.next()).type).toBe('paired');
    screen.socket.close(); expect((await stranger.next()).type).toBe('disconnected');
  } finally { [screen, operator, stranger, other].forEach(p => p.socket.close()); }
}, 10000);
