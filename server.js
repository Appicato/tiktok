import cors from "cors";
import express from "express";
import pkg from "tiktok-live-connector";
import { WebSocketServer } from "ws";

const { WebcastPushConnection } = pkg;

// === SETTINGS ===
const DEBUG = false; // Debug-Logs ein/aus
const PORT = process.env.PORT || 3001;

// === EXPRESS SETUP ===
const app = express();
app.use(cors());

app.get("/", (req, res) => {
  res.send("✅ TikTok Backend läuft");
});

const server = app.listen(PORT, () => {
  console.log(`✅ TikTok Backend läuft auf Port ${PORT}`);
});

// === WEBSOCKET SETUP ===
const wss = new WebSocketServer({ server });
const connections = new Map(); // ws → { username, tiktokConnection }

// === GLOBAL ERROR HANDLING ===
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

// === WebSocket Handler ===
wss.on("connection", (ws) => {
  console.log("📡 Frontend verbunden");
  connections.set(ws, { username: null, tiktokConnection: null });

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "changeStreamer" && data.username) {
        const clientData = connections.get(ws);

        if (clientData?.username === data.username) {
          if (DEBUG) console.log(`⏩ ${data.username} ist bereits verbunden.`);
          return;
        }

        if (DEBUG) console.log(`🎯 Streamer wechseln zu: ${data.username}`);
        await startTikTokForClient(ws, data.username);
      }
    } catch (err) {
      console.error("❌ Fehler bei eingehender Nachricht:", err);
    }
  });

  ws.on("close", () => {
    const client = connections.get(ws);
    if (client?.tiktokConnection) {
      client.tiktokConnection.disconnect();
    }
    connections.delete(ws);
    if (DEBUG) console.log("❌ Frontend getrennt");
  });
});

// === TikTok Start Function ===
async function startTikTokForClient(ws, username) {
  const clientData = connections.get(ws);

  // Alte Verbindung trennen
  if (clientData?.tiktokConnection) {
    await clientData.tiktokConnection.disconnect();
  }

  console.log(`🔍 Versuche Verbindung zu ${username}...`);
  const tiktokConnection = new WebcastPushConnection(username);

  try {
    await tiktokConnection.connect();
    console.log(`✅ ${username} ist live – verbunden!`);
    ws.send(JSON.stringify({ type: "status", live: true, username }));
  } catch {
    console.log(
      `⚠️ ${username} ist nicht live oder Verbindung fehlgeschlagen.`
    );
    ws.send(JSON.stringify({ type: "status", live: false, username }));
    return;
  }

  connections.set(ws, { username, tiktokConnection });

  // === Event-Handler ===
  tiktokConnection.on("error", (err) => {
    console.warn("⚠️ TikTok-Event-Fehler:", err?.message || err);
  });

  tiktokConnection.on("streamEnd", () => {
    console.log(`📴 Stream von ${username} beendet.`);
    ws.send(JSON.stringify({ type: "status", live: false, username }));
  });

  tiktokConnection.on("chat", (data) => {
    if (DEBUG) console.log("💬 Chat:", data.uniqueId, ":", data.comment);
    safeSend(ws, {
      type: "chat",
      user: data.uniqueId,
      comment: data.comment,
    });
  });

  tiktokConnection.on("gift", (data) => {
    try {
      const giftName = data?.giftName || "Unbekannt";
      const giftImage = data?.giftDetails?.giftImage?.urlList?.[0] || null;

      if (DEBUG) {
        console.log("🎁 Gift Event:", {
          user: data.uniqueId,
          gift: giftName,
          amount: data.repeatCount || 1,
          image: giftImage,
        });
      }

      safeSend(ws, {
        type: "gift",
        user: data.uniqueId,
        gift: giftName,
        amount: data.repeatCount || 1,
        image: giftImage,
      });
    } catch (err) {
      console.warn("⚠️ Fehler beim Gift-Event:", err);
    }
  });

  tiktokConnection.on("like", (data) => {
    if (DEBUG) console.log("👍 Likes:", data.uniqueId, "+", data.likeCount);
    safeSend(ws, {
      type: "like",
      user: data.uniqueId,
      likes: data.likeCount,
    });
  });

  tiktokConnection.on("roomUser", (data) => {
    if (DEBUG) console.log("👥 Viewers:", data.viewerCount);
    safeSend(ws, {
      type: "viewers",
      count: data.viewerCount,
    });
  });
}

// === Sicheres Senden an den Client ===
function safeSend(ws, obj) {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  } catch (err) {
    console.warn("⚠️ Fehler beim Senden an Client:", err);
  }
}
