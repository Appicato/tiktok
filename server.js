import cors from "cors";
import express from "express";
import pkg from "tiktok-live-connector";
import { WebSocketServer } from "ws";

const { WebcastPushConnection } = pkg;

// 🔹 Globale Error-Handler → Server stürzt nicht ab
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

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
let currentStreamer = "bodenlos_yt";

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

// 🔹 Sicherer Gift-Handler → verhindert giftDetails-Fehler
function safeGiftData(data) {
  if (!data.giftDetails || !data.giftName) {
    console.warn("⚠️ Ungültiges Geschenk-Event empfangen – überspringe.");
    return null;
  }
  return data;
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

  // Chat
  safeBroadcast("chat", (data) => {
    broadcast({ type: "chat", user: data.uniqueId, comment: data.comment });
  });

  // Gifts (mit Fix)
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

  // Likes
  safeBroadcast("like", (data) => {
    broadcast({ type: "like", user: data.uniqueId, likes: data.likeCount });
  });

  // Zuschauer
  safeBroadcast("roomUser", (data) => {
    broadcast({ type: "viewers", count: data.viewerCount });
  });
}

// Alle 10 Minuten neu verbinden
setInterval(() => startTikTok(currentStreamer), 10 * 60 * 1000);

// Erster Start
startTikTok(currentStreamer);
