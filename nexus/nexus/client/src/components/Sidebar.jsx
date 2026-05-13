import { useState, useEffect } from "react";
import "./Sidebar.css";

const TEXT_CHANNELS = [
  { id: "genel", name: "genel" },
  { id: "oyun", name: "oyun" },
  { id: "muzik", name: "müzik" },
];

const VOICE_CHANNELS = [
  { id: "lobi", name: "Lobi" },
  { id: "ekran", name: "Ekran Paylaşım" },
];

const COLORS = ["#4f5fcc", "#1D9E75", "#D85A30", "#BA7517", "#534AB7", "#0F6E56"];

function avatarColor(name) {
  let h = 0;
  for (const c of (name || "?")) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  return COLORS[h];
}

export default function Sidebar({
  user,
  socket,
  activeTextChannel,
  activeVoiceChannel,
  onSelectTextChannel,
  onSelectVoiceChannel,
  onlineUsers,
  mobileOpen,
  onMobileClose,
}) {
  // voiceChannelId -> [{ socketId, username, muted, sharing }]
  const [voiceMembers, setVoiceMembers] = useState({});

  useEffect(() => {
    if (!socket) return;
    const handler = ({ channelId, members }) => {
      setVoiceMembers((prev) => ({ ...prev, [channelId]: members }));
    };
    socket.on("voice:members-update", handler);
    return () => socket.off("voice:members-update", handler);
  }, [socket]);

  return (
    <>
      {/* Mobil overlay */}
      {mobileOpen && <div className="sidebar-overlay" onClick={onMobileClose} />}

      <div className={`sidebar ${mobileOpen ? "sidebar-mobile-open" : ""}`}>
        <div className="sidebar-header">
          <span className="sidebar-server-name">Nexus HQ</span>
          <span className="sidebar-online">{onlineUsers.length} çevrimiçi</span>
        </div>

        <div className="sidebar-scroll">
          <div className="sidebar-section-label">Metin Kanalları</div>
          {TEXT_CHANNELS.map((ch) => (
            <button
              key={ch.id}
              className={`sidebar-channel ${activeTextChannel === ch.id ? "active" : ""}`}
              onClick={() => { onSelectTextChannel(ch.id); onMobileClose?.(); }}
            >
              <span className="ch-hash">#</span> {ch.name}
            </button>
          ))}

          <div className="sidebar-section-label" style={{ marginTop: 12 }}>
            Sesli Kanallar
          </div>
          {VOICE_CHANNELS.map((ch) => {
            const members = voiceMembers[ch.id] || [];
            const isActive = activeVoiceChannel === ch.id;
            return (
              <div key={ch.id}>
                <button
                  className={`sidebar-channel ${isActive ? "active voice-active" : ""}`}
                  onClick={() => {
                    onSelectVoiceChannel(isActive ? null : ch.id);
                    onMobileClose?.();
                  }}
                >
                  <span className="ch-voice">🔊</span>
                  <span className="ch-voice-name">{ch.name}</span>
                  {members.length > 0 && (
                    <span className="ch-member-count">{members.length}</span>
                  )}
                  {isActive && <span className="ch-live">CANLI</span>}
                </button>
                {/* Odadaki kişiler */}
                {members.length > 0 && (
                  <div className="voice-channel-members">
                    {members.map((m) => (
                      <div key={m.socketId} className="vcm-item">
                        <div
                          className="vcm-avatar"
                          style={{ background: avatarColor(m.username) }}
                        >
                          {m.username?.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="vcm-name">
                          {m.username}
                          {m.username === user.username && " (sen)"}
                        </span>
                        {m.muted && <span className="vcm-icon">🔇</span>}
                        {m.sharing && <span className="vcm-icon">📡</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="sidebar-bottom">
          <div
            className="sidebar-avatar"
            style={{ background: avatarColor(user.username) }}
          >
            {user.username.slice(0, 2).toUpperCase()}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-username">{user.username}</div>
            <div className="sidebar-userstatus">● çevrimiçi</div>
          </div>
        </div>
      </div>
    </>
  );
}
