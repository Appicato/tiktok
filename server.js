import cors from "cors";
import express from "express";
import pkg from "tiktok-live-connector";
import { WebSocketServer } from "ws";

const { WebcastPushConnection } = pkg;

// 🔹 Globale Error-Handler
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());

// Test-Endpoint
app.get("/", (req, res) => {
  res.send("✅ TikTok Backend läuft");
});

const server = app.listen(PORT, () => {
  console.log(`✅ TikTok Backend läuft auf Port ${PORT}`);
});

const wss = new WebSocketServer({ server });
const connections = new Map(); // Map: ws → { username, tiktokConnection }

// WebSocket-Verbindung
wss.on("connection", (ws) => {
  console.log("📡 Frontend verbunden");

  // Verbindung in Map speichern
  connections.set(ws, { username: null, tiktokConnection: null });

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "changeStreamer" && data.username) {
        const clientData = connections.get(ws);

        // 🚫 Falls der gleiche Streamer bereits aktiv ist → Ignorieren
        if (clientData?.username && clientData.username === data.username) {
          console.log(
            `⏩ Streamer ${data.username} ist bereits verbunden – ignoriere Anfrage.`
          );
          return;
        }

        console.log(`🎯 Streamer wechseln zu: ${data.username}`);
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
  });
});

// Broadcast an **alle** verbundenen Clients
function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const [client] of connections) {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  }
}

// 🔹 Sicherer Gift-Handler
function safeGiftData(data) {
  if (!data.giftDetails || !data.giftDetails.giftImage || !data.giftName) {
    console.warn("⚠️ Ungültiges Geschenk-Event – überspringe.");
    return null;
  }
  return data;
}

// 🔹 Starte TikTok-Stream für einen bestimmten Client
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
      `⚠️ ${username} ist aktuell nicht live oder Verbindung fehlgeschlagen.`
    );
    ws.send(JSON.stringify({ type: "status", live: false, username }));
    return;
  }

  // Speichern
  connections.set(ws, { username, tiktokConnection });

  // Fehler-Events abfangen
  tiktokConnection.on("error", (err) => {
    console.warn("⚠️ TikTok-Event-Fehler:", err?.message || err);
  });

  // Stream-Ende
  tiktokConnection.on("streamEnd", () => {
    console.log(`📴 Stream von ${username} beendet.`);
    ws.send(JSON.stringify({ type: "status", live: false, username }));
  });

  // Chat
  tiktokConnection.on("chat", (data) => {
    ws.send(
      JSON.stringify({
        type: "chat",
        user: data.uniqueId,
        comment: data.comment,
      })
    );
  });

  // Gifts
  tiktokConnection.on("gift", (data) => {
    const safeData = safeGiftData(data);
    if (!safeData) return;
    ws.send(
      JSON.stringify({
        type: "gift",
        user: safeData.uniqueId,
        gift: safeData.giftName,
        amount: safeData.repeatCount || 1,
      })
    );
  });

  // Likes
  tiktokConnection.on("like", (data) => {
    ws.send(
      JSON.stringify({
        type: "like",
        user: data.uniqueId,
        likes: data.likeCount,
      })
    );
  });

  // Zuschauer
  tiktokConnection.on("roomUser", (data) => {
    ws.send(JSON.stringify({ type: "viewers", count: data.viewerCount }));
  });
}
