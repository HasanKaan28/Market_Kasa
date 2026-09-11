import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = 5174;

function loadLocalEnv() {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

loadLocalEnv();

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

  if (req.method === 'POST' && req.url === '/api/send-verification') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const { recipient, code } = JSON.parse(body);
        if (!recipient || !code || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Geçerli bir alıcı e-posta ve kod gerekli.' }));
          return;
        }

        if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Resend ortam değişkenleri yapılandırılmamış.' }));
          return;
        }

        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: [recipient],
            subject: 'Market Kasa e-posta doğrulama kodu',
            text: `Market Kasa doğrulama kodunuz: ${code}\n\nBu kodu uygulamadaki doğrulama alanına girin.`
          })
        });

        const responseText = await resendResponse.text();
        if (!resendResponse.ok) {
          console.error('[EMAIL] Resend hatası:', responseText);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'E-posta sağlayıcısı gönderimi reddetti.' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sent: true }));
      } catch (error) {
        console.error('[EMAIL] Doğrulama e-postası hatası:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Doğrulama e-postası gönderilemedi.' }));
      }
    });
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
