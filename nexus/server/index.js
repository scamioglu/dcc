const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// ─── In-memory state ─────────────────────────────────────────────────────────
const channels = {
  text: [
    { id: "genel", name: "genel", type: "text" },
    { id: "oyun", name: "oyun", type: "text" },
    { id: "muzik", name: "müzik", type: "text" },
  ],
  voice: [
    { id: "lobi", name: "Lobi", type: "voice" },
    { id: "ekran", name: "Ekran Paylaşım", type: "voice" },
  ],
};

// channelId -> [{ id, text, author, authorId, timestamp }]
const messages = { genel: [], oyun: [], muzik: [] };

// channelId -> { socketId: { userId, username, muted, videoOff, sharing } }
const voiceRooms = { lobi: {}, ekran: {} };

// socketId -> { userId, username, currentVoice }
const users = {};

// ─── REST ─────────────────────────────────────────────────────────────────────
app.get("/channels", (req, res) => res.json(channels));

app.get("/messages/:channelId", (req, res) => {
  const msgs = messages[req.params.channelId] || [];
  res.json(msgs.slice(-100)); // Son 100 mesaj
});

app.get("/voice/:channelId/members", (req, res) => {
  const room = voiceRooms[req.params.channelId] || {};
  res.json(Object.values(room));
});

app.get("/health", (req, res) => res.json({ ok: true }));

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[+] ${socket.id} bağlandı`);

  // Kullanıcı giriş
  socket.on("user:join", ({ username }) => {
    const userId = uuidv4();
    users[socket.id] = { userId, username, currentVoice: null };
    socket.emit("user:joined", { userId, username });
    io.emit("users:update", getOnlineUsers());
    console.log(`[join] ${username} (${userId})`);
  });

  // ── Metin mesajı ─────────────────────────────────────────────────────────
  socket.on("message:send", ({ channelId, text }) => {
    const user = users[socket.id];
    if (!user || !text?.trim()) return;

    const msg = {
      id: uuidv4(),
      text: text.trim(),
      author: user.username,
      authorId: user.userId,
      timestamp: Date.now(),
    };

    if (!messages[channelId]) messages[channelId] = [];
    messages[channelId].push(msg);

    // Sadece o kanalı dinleyenlere gönder
    io.to(`channel:${channelId}`).emit("message:new", { channelId, msg });
  });

  // Kanal odasına katıl/ayrıl
  socket.on("channel:join", (channelId) => {
    // Önceki metin kanalı odalarından çık
    Object.keys(socket.rooms).forEach((room) => {
      if (room.startsWith("channel:")) socket.leave(room);
    });
    socket.join(`channel:${channelId}`);
  });

  // ── Sesli kanal ──────────────────────────────────────────────────────────
  socket.on("voice:join", ({ channelId }) => {
    const user = users[socket.id];
    if (!user) return;

    // Önceki sesli kanaldan çık
    if (user.currentVoice) {
      leaveVoice(socket, user.currentVoice);
    }

    user.currentVoice = channelId;
    if (!voiceRooms[channelId]) voiceRooms[channelId] = {};

    voiceRooms[channelId][socket.id] = {
      socketId: socket.id,
      userId: user.userId,
      username: user.username,
      muted: false,
      videoOff: false,
      sharing: false,
    };

    socket.join(`voice:${channelId}`);

    // Yeni üyeye mevcut üyeleri bildir
    const existingPeers = Object.keys(voiceRooms[channelId]).filter(
      (id) => id !== socket.id
    );
    socket.emit("voice:existing-peers", { peers: existingPeers, channelId });

    // Mevcut üyelere yeni birinin geldiğini bildir
    socket.to(`voice:${channelId}`).emit("voice:peer-joined", {
      peerId: socket.id,
      user: voiceRooms[channelId][socket.id],
    });

    io.to(`voice:${channelId}`).emit("voice:members-update", {
      channelId,
      members: Object.values(voiceRooms[channelId]),
    });

    console.log(`[voice] ${user.username} -> ${channelId}`);
  });

  socket.on("voice:leave", ({ channelId }) => {
    leaveVoice(socket, channelId);
  });

  socket.on("voice:toggle-mute", ({ channelId }) => {
    const room = voiceRooms[channelId];
    if (!room?.[socket.id]) return;
    room[socket.id].muted = !room[socket.id].muted;
    io.to(`voice:${channelId}`).emit("voice:peer-state", {
      peerId: socket.id,
      state: { muted: room[socket.id].muted },
    });
  });

  socket.on("voice:toggle-sharing", ({ channelId }) => {
    const room = voiceRooms[channelId];
    if (!room?.[socket.id]) return;
    room[socket.id].sharing = !room[socket.id].sharing;
    io.to(`voice:${channelId}`).emit("voice:peer-state", {
      peerId: socket.id,
      state: { sharing: room[socket.id].sharing },
    });
  });

  // ── WebRTC sinyalleme ─────────────────────────────────────────────────────
  // Offer, Answer, ICE Candidate — sunucu sadece iletir, medya P2P gider
  socket.on("webrtc:offer", ({ to, offer, channelId }) => {
    io.to(to).emit("webrtc:offer", { from: socket.id, offer, channelId });
  });

  socket.on("webrtc:answer", ({ to, answer }) => {
    io.to(to).emit("webrtc:answer", { from: socket.id, answer });
  });

  socket.on("webrtc:ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("webrtc:ice-candidate", { from: socket.id, candidate });
  });

  // ── Bağlantı kesilince ────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (user?.currentVoice) leaveVoice(socket, user.currentVoice);
    delete users[socket.id];
    io.emit("users:update", getOnlineUsers());
    console.log(`[-] ${socket.id} ayrıldı`);
  });
});

// ── Yardımcılar ───────────────────────────────────────────────────────────────
function leaveVoice(socket, channelId) {
  const room = voiceRooms[channelId];
  if (!room) return;
  delete room[socket.id];
  socket.leave(`voice:${channelId}`);
  if (users[socket.id]) users[socket.id].currentVoice = null;

  socket.to(`voice:${channelId}`).emit("voice:peer-left", {
    peerId: socket.id,
  });
  io.to(`voice:${channelId}`).emit("voice:members-update", {
    channelId,
    members: Object.values(room),
  });
}

function getOnlineUsers() {
  return Object.entries(users).map(([socketId, u]) => ({
    socketId,
    ...u,
  }));
}

// ── Başlat ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 Nexus sunucu çalışıyor: http://localhost:${PORT}\n`);
});
