import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import Sidebar from "./components/Sidebar.jsx";
import ChatArea from "./components/ChatArea.jsx";
import VoiceRoom from "./components/VoiceRoom.jsx";
import MemberList from "./components/MemberList.jsx";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";
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
    if (!name || name.length < 2)  { setLoginError("En az 2 karakter gir.");      return; }
    if (name.length > 20)           { setLoginError("En fazla 20 karakter.");       return; }
    if (!socket?.connected)         { setLoginError("Sunucuya bağlanılamıyor..."); return; }
    socket.once("user:joined", ({ userId, username }) => setUser({ userId, username }));
    socket.emit("user:join", { username: name });
  };

  if (!user) return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">N</div>
        <h1 className="login-title">Nexus'a hoş geldin</h1>
        <p className="login-sub">Arkadaşlarınla sohbet et, sesli konuş ve ekran paylaş.</p>
        <div className="login-status">
          <span className="status-dot" style={{ background: connected ? "var(--green)" : "#555870" }} />
          {connected ? "Sunucuya bağlı" : "Bağlanıyor..."}
        </div>
        <input className="login-input" type="text" placeholder="Kullanıcı adın"
          value={loginInput}
          onChange={(e) => { setLoginInput(e.target.value); setLoginError(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          maxLength={20} autoFocus />
        {loginError && <p className="login-error">{loginError}</p>}
        <button className="login-btn" onClick={handleLogin}>Giriş Yap</button>
      </div>
    </div>
  );

  const selectTextChannel  = (ch) => { setActiveTextChannel(ch);  setMobileTab(TAB.CHAT); };
  const selectVoiceChannel = (ch) => {
    setActiveVoiceChannel(ch);
    // Sesli kanala katılınca mobilde ses sekmesine geç
    if (ch) setMobileTab(TAB.VOICE);
  };

  // Desktop: sağda VoiceRoom yok, kişiler sidebar'da görünüyor
  // Sağ panel sadece üye listesi
  return (
    <div className="app-root">
      {/* ── Desktop ── */}
      <div className="app-desktop">
        <Sidebar
          user={user} socket={socket}
          activeTextChannel={activeTextChannel}
          activeVoiceChannel={activeVoiceChannel}
          onSelectTextChannel={setActiveTextChannel}
          onSelectVoiceChannel={setActiveVoiceChannel}
          onlineUsers={onlineUsers}
        />
        <div className="app-center">
          <ChatArea user={user} socket={socket} channelId={activeTextChannel} />
          {/* Sesli odadaysa altta şerit göster */}
          {activeVoiceChannel && (
            <VoiceBar
              user={user} socket={socket}
              channelId={activeVoiceChannel}
              onLeave={() => setActiveVoiceChannel(null)}
              onExpand={() => {/* masa üstünde panel olarak açılabilir */}}
            />
          )}
        </div>
        <MemberList onlineUsers={onlineUsers} />
      </div>

      {/* ── Mobil ── */}
      <div className="app-mobile">
        <div className="mob-content">
          {mobileTab === TAB.CHANNELS && (
            <Sidebar user={user} socket={socket}
              activeTextChannel={activeTextChannel}
              activeVoiceChannel={activeVoiceChannel}
              onSelectTextChannel={selectTextChannel}
              onSelectVoiceChannel={selectVoiceChannel}
              onlineUsers={onlineUsers} isMobilePanel />
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

        <nav className="mob-nav">
          <button className={`mob-nav-btn ${mobileTab===TAB.CHANNELS?"mob-active":""}`}
            onClick={() => setMobileTab(TAB.CHANNELS)}>
            <span className="mob-nav-icon">☰</span>
            <span className="mob-nav-label">Kanallar</span>
          </button>
          <button className={`mob-nav-btn ${mobileTab===TAB.CHAT?"mob-active":""}`}
            onClick={() => setMobileTab(TAB.CHAT)}>
            <span className="mob-nav-icon">#</span>
            <span className="mob-nav-label">{activeTextChannel}</span>
          </button>
          <button
            className={`mob-nav-btn ${mobileTab===TAB.VOICE?"mob-active":""} ${activeVoiceChannel?"voice-live":""}`}
            onClick={() => activeVoiceChannel && setMobileTab(TAB.VOICE)}
            disabled={!activeVoiceChannel}>
            <span className="mob-nav-icon">🔊</span>
            <span className="mob-nav-label">{activeVoiceChannel || "Ses"}</span>
            {activeVoiceChannel && <span className="mob-live-dot" />}
          </button>
          <button className={`mob-nav-btn ${mobileTab===TAB.MEMBERS?"mob-active":""}`}
            onClick={() => setMobileTab(TAB.MEMBERS)}>
            <span className="mob-nav-icon">👥</span>
            <span className="mob-nav-label">Üyeler</span>
          </button>
        </nav>
      </div>
    </div>
  );
}

/* ── Desktop alt ses şeridi ── */
function VoiceBar({ user, socket, channelId, onLeave }) {
  const [isMuted, setIsMuted] = useState(false);
  const localStreamRef = useRef(null);

  // Bu component sadece gösterge — gerçek VoiceRoom başka yerde
  // Buton ile sessize al veya ayrıl
  const toggleMute = () => {
    setIsMuted((m) => !m);
    socket?.emit("voice:toggle-mute", { channelId });
  };

  return (
    <div className="voice-bar">
      <span className="vbar-dot" />
      <span className="vbar-channel">🔊 {channelId}</span>
      <span className="vbar-status">Sesli bağlı</span>
      <div className="vbar-actions">
        <button className={`vbar-btn ${isMuted?"danger":""}`} onClick={toggleMute}>
          {isMuted ? "🔇" : "🎤"}
        </button>
        <button className="vbar-btn leave" onClick={onLeave}>📴</button>
      </div>
    </div>
  );
}
