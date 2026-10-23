export function socketURL() { return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/control`; }
export function startPuppetControl(api) {
  const badge = document.createElement('button');
  badge.textContent = 'Connect controller';
  badge.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:2147483647;background:#17221f;color:#dbf6a5;border:1px solid #65735d;border-radius:5px;padding:8px 12px;font:12px monospace';
  document.body.append(badge);
  let socket, paired = false, timer, last = '', queue = Promise.resolve();
  const results = new Map();
  function projection() {
    const inspect = api.inspect();
    const state = inspect.state;
    const find = value => {
      if (!value || typeof value !== 'object') return null;
      if (value.messages?.conversations && value.messagesBrowsing) return value;
      for (const child of Object.values(value)) { const found = find(child); if (found) return found; }
      return null;
    };
    const root = find(state);
    return { profile: state.profile?.id, available: !!root,
      windows: root?.messagesBrowsing.windows ?? [],
      conversations: (root?.messages.conversations ?? []).map(row => ({ id: row.id, name: row.name, unread: row.unread,
        items: row.items.slice(-80).map(item => ({ id: item.id, text: item.text, direction: item.direction })) })) };
  }
  function publish(force = false) {
    if (!paired || socket?.readyState !== 1) return;
    const state = projection(), encoded = JSON.stringify(state);
    if (force || encoded !== last) { last = encoded; socket.send(JSON.stringify({ type: 'state', state })); }
  }
  badge.onclick = () => {
    if (socket) { socket.close(); return; }
    socket = new WebSocket(socketURL());
    badge.textContent = 'Connecting…';
    socket.onopen = () => socket.send(JSON.stringify({ type: 'register' }));
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === 'registered') badge.textContent = `Pair: ${message.code} · click to disconnect`;
      if (message.type === 'paired') { paired = true; badge.hidden = true; publish(true); }
      if (message.type === 'disconnected') { paired = false; badge.hidden = false; }
      if (message.type === 'cue') {
        queue = queue.then(async () => {
          if (typeof message.id !== 'string' || message.id.length > 128) return;
          let result = results.get(message.id);
          if (!result) {
            try { result = await api.execute({ requestId: message.id, command: 'messages.incoming.cue',
              target: { windowId: message.windowId, conversationId: message.conversationId }, payload: { text: message.text } }); }
            catch { result = { status: 'rejected', message: 'The puppet could not complete this cue.' }; }
            results.set(message.id, result);
            if (results.size > 256) results.delete(results.keys().next().value);
          }
          if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'result', id: message.id, result }));
          publish(true);
        });
      }
    };
    socket.onclose = () => { socket = null; paired = false; badge.hidden = false; badge.textContent = 'Connect controller'; clearInterval(timer); };
    timer = setInterval(() => publish(), 500);
  };
}
