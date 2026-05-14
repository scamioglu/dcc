import { useState, useEffect, useRef } from "react";
import "./ChatArea.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";
const COLORS = ["#7c8bc4","#5DCAA5","#F0997B","#EF9F27","#9f88e8","#60bfb0"];

function avatarColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  return COLORS[h];
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  const diff = today.getDate() - d.getDate();
  if (diff === 0) return "Bugün";
  if (diff === 1) return "Dün";
  return d.toLocaleDateString("tr-TR");
}

export default function ChatArea({ user, socket, channelId, voiceActive }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);
  const prevChannelRef = useRef(null);

  // Kanal değişince mesajları yükle
  useEffect(() => {
    setMessages([]);
    fetch(`${SERVER_URL}/messages/${channelId}`)
      .then((r) => r.json())
      .then(setMessages)
      .catch(() => {});

    socket?.emit("channel:join", channelId);
    prevChannelRef.current = channelId;
  }, [channelId, socket]);

  // Yeni mesaj dinle
  useEffect(() => {
    if (!socket) return;
    const handler = ({ channelId: cId, msg }) => {
      if (cId === channelId) {
        setMessages((prev) => [...prev, msg]);
      }
    };
    socket.on("message:new", handler);
    return () => socket.off("message:new", handler);
  }, [socket, channelId]);

  // Otomatik scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text || !socket) return;
    socket.emit("message:send", { channelId, text });
    setInput("");
  };

  // Mesajları gruplayan yardımcı (aynı kişi ardışık mesajlar)
  const grouped = messages.reduce((acc, msg, i) => {
    const prev = messages[i - 1];
    const sameAuthor = prev?.authorId === msg.authorId;
    const closeInTime = prev && msg.timestamp - prev.timestamp < 5 * 60 * 1000;
    acc.push({ ...msg, showHeader: !sameAuthor || !closeInTime });
    return acc;
  }, []);

  return (
    <div className={`chat-area${voiceActive ? " voice-active" : ""}`}>
      <div className="chat-header">
        <span className="chat-hash">#</span>
        <span className="chat-channel-name">{channelId}</span>
      </div>

      <div className="chat-messages">
        {grouped.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">#</div>
            <p>
              <strong>{channelId}</strong> kanalına hoş geldin!
            </p>
            <p>Burası bu kanalın başlangıcı.</p>
          </div>
        )}
        {grouped.map((msg) => (
          <div
            key={msg.id}
            className={`chat-msg ${msg.showHeader ? "with-header" : "compact"}`}
          >
            {msg.showHeader ? (
              <>
                <div
                  className="chat-msg-avatar"
                  style={{ background: avatarColor(msg.author) }}
                >
                  {msg.author.slice(0, 2).toUpperCase()}
                </div>
                <div className="chat-msg-body">
                  <div className="chat-msg-meta">
                    <span
                      className="chat-msg-author"
                      style={{ color: avatarColor(msg.author) }}
                    >
                      {msg.author}
                    </span>
                    <span className="chat-msg-time">
                      {formatDate(msg.timestamp)} {formatTime(msg.timestamp)}
                    </span>
                  </div>
                  <p className="chat-msg-text">{msg.text}</p>
                </div>
              </>
            ) : (
              <>
                <div className="chat-msg-time-only">
                  {formatTime(msg.timestamp)}
                </div>
                <p className="chat-msg-text">{msg.text}</p>
              </>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-bar">
        <button className="chat-attach-btn" title="Dosya ekle">+</button>
        <input
          className="chat-input"
          placeholder={`#${channelId} kanalına mesaj yaz...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
          maxLength={2000}
        />
        <button
          className="chat-send-btn"
          onClick={sendMessage}
          disabled={!input.trim()}
          title="Gönder (Enter)"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
