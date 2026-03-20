const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const file = path.join(__dirname, 'public', 'air-hockey.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(obj));
}

wss.on('connection', ws => {
  ws._code = null;
  ws._role = null;
  ws._name = 'Player';

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'create': {
        const code = String(msg.code || '').trim();
        if (!code) { send(ws, { type: 'error', text: 'Invalid code' }); return; }
        if (rooms.has(code)) { send(ws, { type: 'error', text: 'Room already exists' }); return; }
        ws._name = String(msg.name || 'Host').slice(0, 20);
        ws._code = code;
        ws._role = 'host';
        rooms.set(code, { host: ws, guest: null });
        send(ws, { type: 'created', code });
        console.log(`[+] Room ${code} by ${ws._name}`);
        break;
      }

      case 'join': {
        const code = String(msg.code || '').trim();
        const room = rooms.get(code);
        if (!room)      { send(ws, { type: 'error', text: 'Room not found!' }); return; }
        if (room.guest) { send(ws, { type: 'error', text: 'Room is full!' });   return; }
        ws._name = String(msg.name || 'Guest').slice(0, 20);
        ws._code = code;
        ws._role = 'guest';
        room.guest = ws;
        send(ws,        { type: 'joined',          hostName:  room.host._name });
        send(room.host, { type: 'opponent_joined', guestName: ws._name });
        console.log(`[+] Room ${code}: ${ws._name} joined`);
        break;
      }

      // relay opponent paddle (normalised 0-1)
      case 'paddle': {
        const room = rooms.get(ws._code);
        if (!room) return;
        const opp = ws._role === 'host' ? room.guest : room.host;
        send(opp, { type: 'paddle', x: msg.x, y: msg.y });
        break;
      }

      // host sends puck state to guest
      case 'puck': {
        const room = rooms.get(ws._code);
        if (!room || ws._role !== 'host') return;
        send(room.guest, { type: 'puck', x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy });
        break;
      }

      // host sends goal event to guest
      case 'goal': {
        const room = rooms.get(ws._code);
        if (!room || ws._role !== 'host') return;
        send(room.guest, { type: 'goal', s1: msg.s1, s2: msg.s2, scorer: msg.scorer });
        break;
      }

      // host sends gameover to guest
      case 'gameover': {
        const room = rooms.get(ws._code);
        if (!room || ws._role !== 'host') return;
        send(room.guest, { type: 'gameover', s1: msg.s1, s2: msg.s2 });
        break;
      }

      // either side requests restart - server tells both
      case 'restart': {
        const room = rooms.get(ws._code);
        if (!room) return;
        send(room.host,  { type: 'restart' });
        send(room.guest, { type: 'restart' });
        break;
      }

      case 'ping':
        send(ws, { type: 'pong' });
        break;
    }
  });

  ws.on('close', () => {
    const code = ws._code;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const opp = ws._role === 'host' ? room.guest : room.host;
    send(opp, { type: 'left' });
    rooms.delete(code);
    console.log(`[-] Room ${code} closed`);
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`Air Smash server on port ${PORT}`);
});
