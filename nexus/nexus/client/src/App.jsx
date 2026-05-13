import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import Sidebar from "./components/Sidebar.jsx";
import ChatArea from "./components/ChatArea.jsx";
import VoiceRoom from "./components/VoiceRoom.jsx";
import MemberList from "./components/MemberList.jsx";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";

export default function App() {
  const [user, setUser] = useState(null);
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [activeTextChannel, setActiveTextChannel] = useState("genel");
  const [activeVoiceChannel, setActiveVoiceChannel] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [loginInput, setLoginInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

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
    if (!name || name.length < 2) { setLoginError("En az 2 karakter gir."); return; }
    if (name.length > 20) { setLoginError("En fazla 20 karakter."); return; }
    if (!socket?.connected) { setLoginError("Sunucuya bağlanılamıyor..."); return; }
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

  return (
    <div className="app-layout">
      {/* Mobil üst bar */}
      <div className="mobile-topbar">
        <button className="mobile-btn" onClick={() => setSidebarOpen(true)}>☰</button>
        <span className="mobile-title">#{activeTextChannel}</span>
        <button className="mobile-btn" onClick={() => setMembersOpen((v) => !v)}>👥</button>
      </div>

      <div className="app-body">
        <Sidebar
          user={user}
          socket={socket}
          activeTextChannel={activeTextChannel}
          activeVoiceChannel={activeVoiceChannel}
          onSelectTextChannel={(ch) => { setActiveTextChannel(ch); setSidebarOpen(false); }}
          onSelectVoiceChannel={(ch) => { setActiveVoiceChannel(ch); setSidebarOpen(false); }}
          onlineUsers={onlineUsers}
          mobileOpen={sidebarOpen}
          onMobileClose={() => setSidebarOpen(false)}
        />

        <ChatArea user={user} socket={socket} channelId={activeTextChannel} />

        {/* Sağ panel: sesli oda veya üye listesi */}
        <div className={`right-panel ${membersOpen ? "right-panel-mobile-open" : ""}`}>
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
      </div>
    </div>
  );
}
