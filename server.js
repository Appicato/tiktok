import cors from "cors";
import express from "express";
import fetch from "node-fetch";
import pkg from "tiktok-live-connector";
import { WebSocketServer } from "ws";

const { WebcastPushConnection } = pkg;

const EULER_API_KEY = "DEIN_EULER_API_KEY";

const app = express();
app.use(cors());

app.get("/api/live-status/:username", async (req, res) => {
  const username = req.params.username;
  const eulerUrl = `https://api.eulerstream.com/api/live/status?username=${username}`;

  try {
    const r = await fetch(eulerUrl, {
      headers: { "x-api-key": EULER_API_KEY },
    });

    if (!r.ok) {
      console.warn("⚠️ Eulerstream API antwortet nicht korrekt:", r.status);
      return res.status(r.status).json({ error: "Eulerstream API Fehler" });
    }

    const data = await r.json();
    return res.json(data);
  } catch (err) {
    console.error("❌ Fehler bei Eulerstream API:", err);
    return res.status(500).json({ error: "Eulerstream API nicht erreichbar" });
  }
});

const server = app.listen(3001, () => {
  console.log("✅ TikTok Backend läuft auf Port 3001");
});

const wss = new WebSocketServer({ server });

const connections = new Set();
let tiktokConnection = null;
let currentStreamer = "mo__dawa";

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
    if (ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  }
}

function safeGiftData(data) {
  if (!data.giftDetails) {
    console.warn("Warnung: giftDetails fehlt im Geschenk-Event.");
    return null;
  }
  return data;
}

// **Hier den Live-Status via lokalen Proxy abfragen!**
async function isUserLive(username) {
  try {
    const res = await fetch(
      `http://localhost:3001/api/live-status/${username}`
    );

    if (!res.ok) {
      console.error("Fehler beim lokalen Live-Status-Proxy:", res.status);
      return false;
    }

    const data = await res.json();
    return data.live === true;
  } catch (err) {
    console.error("Fehler beim lokalen Live-Status-Proxy:", err);
    return false;
  }
}

async function startTikTok(username) {
  if (tiktokConnection) {
    await tiktokConnection.disconnect();
    tiktokConnection = null;
  }

  if (!(await isUserLive(username))) {
    console.log(`⚠️ ${username} ist aktuell nicht live.`);
    broadcast({ type: "status", live: false, username });
    return;
  }

  console.log(`✅ ${username} ist live – verbinde...`);
  broadcast({ type: "status", live: true, username });

  tiktokConnection = new WebcastPushConnection(username);

  await tiktokConnection.connect().catch((err) => {
    console.error("❌ Verbindung fehlgeschlagen:", err);
  });

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
    if (!safeData || !safeData.giftName) return;
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

// Intervall verlängert (10 min)
setInterval(() => startTikTok(currentStreamer), 10 * 60 * 1000);

startTikTok(currentStreamer);


// https://www.eulerstream.com/dashboard/api-keys
//https://github.com/isaackogan/TikTokLive
// https://chatgpt.com/c/6888d086-375c-8326-abac-48ce6d37657b
// https://github.com/zerodytrash/TikTok-Live-Connector