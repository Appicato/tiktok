import cors from "cors";
import express from "express";
import pkg from "tiktok-live-connector";
import { WebSocketServer } from "ws";

const { WebcastPushConnection } = pkg;

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());

// Einfacher Test-Endpoint
app.get("/", (req, res) => {
  res.send("✅ TikTok Backend läuft");
});

const server = app.listen(PORT, () => {
  console.log(`✅ TikTok Backend läuft auf Port ${PORT}`);
});

const wss = new WebSocketServer({ server });

const connections = new Set();
let tiktokConnection = null;
let currentStreamer = "bonusgamertv";

wss.on("connection", (ws) => {
  console.log("📡 Frontend verbunden");
  connections.add(ws);

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "changeStreamer" && data.username) {
        console.log(`🎯 Streamer wechseln zu: ${data.username}`);
        currentStreamer = data.username;
        await startTikTok(currentStreamer);
      }
    } catch {}
  });

  ws.on("close", () => {
    connections.delete(ws);
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of connections) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function safeGiftData(data) {
  return data.giftDetails ? data : null;
}

async function startTikTok(username) {
  // Alte Verbindung schließen
  if (tiktokConnection) {
    await tiktokConnection.disconnect();
    tiktokConnection = null;
  }

  console.log(`🔍 Versuche Verbindung zu ${username}...`);

  tiktokConnection = new WebcastPushConnection(username);

  try {
    await tiktokConnection.connect();
    console.log(`✅ ${username} ist live – verbunden!`);
    broadcast({ type: "status", live: true, username });
  } catch (err) {
    console.log(
      `⚠️ ${username} ist aktuell nicht live oder Verbindung fehlgeschlagen.`
    );
    broadcast({ type: "status", live: false, username });
    return;
  }

  const safeBroadcast = (type, handler) => {
    tiktokConnection.on(type, (data) => {
      try {
        handler(data);
      } catch (err) {
        console.error(`❌ Fehler beim Event ${type}:`, err);
      }
    });
  };

  safeBroadcast("chat", (data) => {
    broadcast({ type: "chat", user: data.uniqueId, comment: data.comment });
  });

  safeBroadcast("gift", (data) => {
    const safeData = safeGiftData(data);
    if (!safeData) return;
    broadcast({
      type: "gift",
      user: safeData.uniqueId,
      gift: safeData.giftName,
      amount: safeData.repeatCount || 1,
    });
  });

  safeBroadcast("like", (data) => {
    broadcast({ type: "like", user: data.uniqueId, likes: data.likeCount });
  });

  safeBroadcast("roomUser", (data) => {
    broadcast({ type: "viewers", count: data.viewerCount });
  });
}

// Alle 10 Minuten neu verbinden
setInterval(() => startTikTok(currentStreamer), 10 * 60 * 1000);

// Erster Start
startTikTok(currentStreamer);

// https://www.eulerstream.com/dashboard/api-keys
//https://github.com/isaackogan/TikTokLive
// https://chatgpt.com/c/6888d086-375c-8326-abac-48ce6d37657b
// https://github.com/zerodytrash/TikTok-Live-Connector
