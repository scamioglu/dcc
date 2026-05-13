import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import Sidebar from "./components/Sidebar.jsx";
import ChatArea from "./components/ChatArea.jsx";
import VoiceRoom from "./components/VoiceRoom.jsx";
import MemberList from "./components/MemberList.jsx";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";

export default function App() {
  const [user, setUser] = useState(null); // { userId, username }
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [activeTextChannel, setActiveTextChannel] = useState("genel");
  const [activeVoiceChannel, setActiveVoiceChannel] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [loginInput, setLoginInput] = useState("");
  const [loginError, setLoginError] = useState("");

  // Socket bağlantısı
  useEffect(() => {
    const sock = io(SERVER_URL, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    sock.on("connect", () => setConnected(true));
    sock.on("disconnect", () => setConnected(false));
    sock.on("users:update", setOnlineUsers);
    setSocket(sock);
    return () => sock.disconnect();
  }, []);

  const handleLogin = () => {
    const name = loginInput.trim();
    if (!name || name.length < 2) {
      setLoginError("En az 2 karakter gir.");
      return;
    }
    if (name.length > 20) {
      setLoginError("En fazla 20 karakter olabilir.");
      return;
    }
    if (!socket?.connected) {
      setLoginError("Sunucuya bağlanılamıyor. Lütfen bekle...");
      return;
    }

    socket.once("user:joined", ({ userId, username }) => {
      setUser({ userId, username });
    });
    socket.emit("user:join", { username: name });
  };

  // ── Giriş ekranı ────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo">N</div>
          <h1 className="login-title">Nexus'a hoş geldin</h1>
          <p className="login-sub">
            Arkadaşlarınla sohbet et, sesli konuş ve ekran paylaş.
          </p>
          <div className="login-status">
            <span
              className="status-dot"
              style={{ background: connected ? "var(--green)" : "#555870" }}
            />
            {connected ? "Sunucuya bağlı" : "Bağlanıyor..."}
          </div>
          <input
            className="login-input"
            type="text"
            placeholder="Kullanıcı adın"
            value={loginInput}
            onChange={(e) => {
              setLoginInput(e.target.value);
              setLoginError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            maxLength={20}
            autoFocus
          />
          {loginError && <p className="login-error">{loginError}</p>}
          <button className="login-btn" onClick={handleLogin}>
            Giriş Yap
          </button>
        </div>
      </div>
    );
  }

  // ── Ana uygulama ─────────────────────────────────────────────────────────────
  return (
    <div className="app-layout">
      <Sidebar
        user={user}
        socket={socket}
        activeTextChannel={activeTextChannel}
        activeVoiceChannel={activeVoiceChannel}
        onSelectTextChannel={setActiveTextChannel}
        onSelectVoiceChannel={setActiveVoiceChannel}
        onlineUsers={onlineUsers}
      />
      <ChatArea
        user={user}
        socket={socket}
        channelId={activeTextChannel}
      />
      {activeVoiceChannel ? (
        <VoiceRoom
          user={user}
          socket={socket}
          channelId={activeVoiceChannel}
          onLeave={() => setActiveVoiceChannel(null)}
        />
      ) : (
        <MemberList onlineUsers={onlineUsers} />
      )}
    </div>
  );
}
