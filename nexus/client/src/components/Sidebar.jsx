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
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
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
}) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-server-name">Nexus HQ</span>
        <span className="sidebar-online">{onlineUsers.length} çevrimiçi</span>
      </div>

      <div className="sidebar-section-label">Metin Kanalları</div>
      {TEXT_CHANNELS.map((ch) => (
        <button
          key={ch.id}
          className={`sidebar-channel ${activeTextChannel === ch.id ? "active" : ""}`}
          onClick={() => onSelectTextChannel(ch.id)}
        >
          <span className="ch-hash">#</span> {ch.name}
        </button>
      ))}

      <div className="sidebar-section-label" style={{ marginTop: 12 }}>
        Sesli Kanallar
      </div>
      {VOICE_CHANNELS.map((ch) => (
        <button
          key={ch.id}
          className={`sidebar-channel ${activeVoiceChannel === ch.id ? "active voice-active" : ""}`}
          onClick={() =>
            onSelectVoiceChannel(activeVoiceChannel === ch.id ? null : ch.id)
          }
        >
          <span className="ch-voice">🔊</span> {ch.name}
          {activeVoiceChannel === ch.id && (
            <span className="ch-live">CANLI</span>
          )}
        </button>
      ))}

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
  );
}
