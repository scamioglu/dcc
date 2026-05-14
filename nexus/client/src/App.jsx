import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import Sidebar from "./components/Sidebar.jsx";
import ChatArea from "./components/ChatArea.jsx";
import VoiceRoom from "./components/VoiceRoom.jsx";
import MemberList from "./components/MemberList.jsx";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "v5";

// Mobilde hangi ekran aktif
const TAB = { CHANNELS: "channels", CHAT: "chat", VOICE: "voice", MEMBERS: "members" };

export default function App() {
  const [user,               setUser]               = useState(null);
  const [socket,             setSocket]             = useState(null);
  const [connected,          setConnected]          = useState(false);
  const [activeTextChannel,  setActiveTextChannel]  = useState("genel");
  const [activeVoiceChannel, setActiveVoiceChannel] = useState(null);
  const [onlineUsers,        setOnlineUsers]        = useState([]);
  const [loginInput,         setLoginInput]         = useState("");
  const [loginError,         setLoginError]         = useState("");
  const [mobileTab,          setMobileTab]          = useState(TAB.CHAT);

  useEffect(() => {
    const sock = io(SERVER_URL, { path: "/socket.io", transports: ["websocket","polling"] });
    sock.on("connect",      () => setConnected(true));
    sock.on("disconnect",   () => setConnected(false));
    sock.on("users:update", setOnlineUsers);
    setSocket(sock);
    return () => sock.disconnect();
  }, []);

  const handleLogin = () => {
    const name = loginInput.trim();
    if (!name || name.length < 2)  { setLoginError("En az 2 karakter gir.");        return; }
    if (name.length > 20)           { setLoginError("En fazla 20 karakter.");         return; }
    if (!socket?.connected)         { setLoginError("Sunucuya bağlanılamıyor...");    return; }
    socket.once("user:joined", ({ userId, username }) => setUser({ userId, username }));
    socket.emit("user:join", { username: name });
  };

  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo">N</div>
          <h1 className="login-title">Nexus'a hoş geldin</h1>
          <p className="login-sub">Arkadaşlarınla sohbet et, sesli konuş ve ekran paylaş.</p>
          <div className="login-status">
            <span className="status-dot" style={{ background: connected ? "var(--green)" : "#555870" }} />
            {connected ? "Sunucuya bağlı" : "Bağlanıyor..."}
            <span className="login-version">{APP_VERSION}</span>
          </div>
          <input
            className="login-input" type="text" placeholder="Kullanıcı adın"
            value={loginInput}
            onChange={(e) => { setLoginInput(e.target.value); setLoginError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            maxLength={20} autoFocus
          />
          {loginError && <p className="login-error">{loginError}</p>}
          <button className="login-btn" onClick={handleLogin}>Giriş Yap</button>
        </div>
      </div>
    );
  }

  const selectTextChannel = (ch) => {
    setActiveTextChannel(ch);
    setMobileTab(TAB.CHAT);
  };

  const selectVoiceChannel = (ch) => {
    setActiveVoiceChannel(ch);
    if (ch) setMobileTab(TAB.VOICE);
  };

  return (
    <div className="app-root">
      {/* ── Desktop layout ── */}
      <div className="app-desktop">
        <Sidebar
          user={user} socket={socket}
          activeTextChannel={activeTextChannel}
          activeVoiceChannel={activeVoiceChannel}
          onSelectTextChannel={setActiveTextChannel}
          onSelectVoiceChannel={setActiveVoiceChannel}
          onlineUsers={onlineUsers}
        />
        <ChatArea user={user} socket={socket} channelId={activeTextChannel} />
        {activeVoiceChannel
          ? <VoiceRoom user={user} socket={socket} channelId={activeVoiceChannel} onLeave={() => setActiveVoiceChannel(null)} />
          : <MemberList onlineUsers={onlineUsers} />
        }
      </div>

      {/* ── Mobil layout ── */}
      <div className="app-mobile">
        {/* İçerik alanı */}
        <div className="mob-content">
          {mobileTab === TAB.CHANNELS && (
            <Sidebar
              user={user} socket={socket}
              activeTextChannel={activeTextChannel}
              activeVoiceChannel={activeVoiceChannel}
              onSelectTextChannel={selectTextChannel}
              onSelectVoiceChannel={selectVoiceChannel}
              onlineUsers={onlineUsers}
              isMobilePanel
            />
          )}
          {mobileTab === TAB.CHAT && (
            <ChatArea user={user} socket={socket} channelId={activeTextChannel} />
          )}
          {mobileTab === TAB.VOICE && activeVoiceChannel && (
            <VoiceRoom user={user} socket={socket} channelId={activeVoiceChannel}
              onLeave={() => { setActiveVoiceChannel(null); setMobileTab(TAB.CHAT); }} />
          )}
          {mobileTab === TAB.MEMBERS && (
            <MemberList onlineUsers={onlineUsers} />
          )}
        </div>

        {/* Alt navigation bar */}
        <nav className="mob-nav">
          <button className={`mob-nav-btn ${mobileTab === TAB.CHANNELS ? "active" : ""}`}
            onClick={() => setMobileTab(TAB.CHANNELS)}>
            <span className="mob-nav-icon">☰</span>
            <span className="mob-nav-label">Kanallar</span>
          </button>
          <button className={`mob-nav-btn ${mobileTab === TAB.CHAT ? "active" : ""}`}
            onClick={() => setMobileTab(TAB.CHAT)}>
            <span className="mob-nav-icon">#</span>
            <span className="mob-nav-label">{activeTextChannel}</span>
          </button>
          <button
            className={`mob-nav-btn ${mobileTab === TAB.VOICE ? "active" : ""} ${activeVoiceChannel ? "voice-live" : ""}`}
            onClick={() => {
              if (activeVoiceChannel) setMobileTab(TAB.VOICE);
            }}
            disabled={!activeVoiceChannel}
          >
            <span className="mob-nav-icon">🔊</span>
            <span className="mob-nav-label">{activeVoiceChannel || "Ses"}</span>
            {activeVoiceChannel && <span className="mob-live-dot" />}
          </button>
          <button className={`mob-nav-btn ${mobileTab === TAB.MEMBERS ? "active" : ""}`}
            onClick={() => setMobileTab(TAB.MEMBERS)}>
            <span className="mob-nav-icon">👥</span>
            <span className="mob-nav-label">Üyeler</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
