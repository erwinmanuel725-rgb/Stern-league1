'use strict';
// Temps réel : Server-Sent Events. Le serveur envoie juste « quelque chose a changé », le navigateur recharge /api/state.
const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(0);
let version = 1;
const MAX_PER_IP = 10;
const perIp = new Map();

function notify() { version++; bus.emit('change', version); }

function handler(req, res) {
  const ip = req.ip;
  const n = perIp.get(ip) || 0;
  if (n >= MAX_PER_IP) return res.status(429).json({ error: 'Trop de connexions temps réel.' });
  perIp.set(ip, n + 1);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`retry: 3000\nevent: hello\ndata: ${version}\n\n`);
  const onChange = (v) => res.write(`event: update\ndata: ${v}\n\n`);
  bus.on('change', onChange);
  const hb = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(hb); bus.off('change', onChange);
    const left = (perIp.get(ip) || 1) - 1;
    left <= 0 ? perIp.delete(ip) : perIp.set(ip, left);
  });
}
module.exports = { notify, handler };
