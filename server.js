import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = 5174;
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', clients: wss.clients.size }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`Market Kasa Canlı Senkronizasyon Sunucusu Aktif. Bağlı Cihaz Sayısı: ${wss.clients.size}`);
});

const wss = new WebSocketServer({ server });

// Keep track of connected clients
let clientCounter = 0;

wss.on('connection', (ws, req) => {
  const clientId = ++clientCounter;
  const ip = req.socket.remoteAddress;
  console.log(`[SYNC] Yeni cihaz bağlandı (ID: ${clientId}, IP: ${ip}). Toplam bağlı: ${wss.clients.size}`);

  // Notify all devices about updated connection count
  broadcastDeviceCount();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      // Attach sender ID to prevent echo
      data.senderId = clientId;

      // Broadcast to all other connected clients
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      });
    } catch (err) {
      console.error('[SYNC] Mesaj ayrıştırma hatası:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[SYNC] Cihaz ayrıldı (ID: ${clientId}). Kalan cihaz: ${wss.clients.size}`);
    broadcastDeviceCount();
  });

  ws.on('error', (err) => {
    console.error(`[SYNC] Cihaz ${clientId} hatası:`, err.message);
  });
});

function broadcastDeviceCount() {
  const payload = JSON.stringify({
    type: 'DEVICE_COUNT',
    count: wss.clients.size
  });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`MARKET KASA SENKRONİZASYON SUNUCUSU ÇALIŞIYOR`);
  console.log(`Port: ${PORT}`);
  console.log(`Yerel Ağ WebSocket: ws://192.168.1.103:${PORT}`);
  console.log(`====================================================`);
});
