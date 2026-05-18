import "./MemberList.css";

const COLORS = ["#4f5fcc", "#1D9E75", "#D85A30", "#BA7517", "#534AB7", "#0F6E56"];
function avatarColor(name) {
  let h = 0;
  for (const c of (name || "?")) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  return COLORS[h];
}

export default function MemberList({ onlineUsers }) {
  return (
    <div className="member-list">
      <div className="member-list-header">Üyeler</div>
      <div className="member-section-label">Çevrimiçi — {onlineUsers.length}</div>
      {onlineUsers.map((u) => (
        <div key={u.socketId} className="member-item">
          <div className="member-avatar" style={{ background: avatarColor(u.username) }}>
            {u.username?.slice(0, 2).toUpperCase()}
          </div>
          <div className="member-info">
            <div className="member-name">{u.username}</div>
            <div className="member-status">
              {u.currentVoice ? `🔊 ${u.currentVoice}` : ""}
            </div>
          </div>
          <div className="member-online-dot" />
        </div>
      ))}
      {onlineUsers.length === 0 && (
        <div className="member-empty">Henüz kimse yok.</div>
      )}
    </div>
  );
}
