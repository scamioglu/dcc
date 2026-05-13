import { useState, useEffect, useRef, useCallback } from "react";
import "./VoiceRoom.css";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
};

export default function VoiceRoom({ user, socket, channelId, onLeave }) {
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [members, setMembers] = useState([]);
  const [status, setStatus] = useState("Mikrofona izin isteniyor...");
  const [fullscreenPeer, setFullscreenPeer] = useState(null); // peerId veya "local"
  const [volumes, setVolumes] = useState({}); // peerId -> 0-1

  const localVideoRef = useRef(null);
  const peersRef = useRef({});
  const remoteStreamsRef = useRef({});
  const audioNodesRef = useRef({}); // peerId -> { gainNode, audioCtx }
  const [remoteVideos, setRemoteVideos] = useState([]);

  // ── Lokal ses al ────────────────────────────────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        setLocalStream(stream);
        setStatus("Bağlı");
        socket?.emit("voice:join", { channelId });
      })
      .catch(() => {
        setStatus("Mikrofon izni yok");
        socket?.emit("voice:join", { channelId });
      });
    return () => {};
  }, []);

  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((t) => t.stop());
      screenStream?.getTracks().forEach((t) => t.stop());
    };
  }, [localStream, screenStream]);

  // ── Peer bağlantısı ─────────────────────────────────────────────────────────
  const createPC = useCallback(
    (peerId) => {
      if (peersRef.current[peerId]) return peersRef.current[peerId];
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peersRef.current[peerId] = pc;

      const activeStream = screenStream || localStream;
      activeStream?.getTracks().forEach((t) => pc.addTrack(t, activeStream));

      pc.ontrack = ({ streams }) => {
        remoteStreamsRef.current[peerId] = streams[0];
        setRemoteVideos(
          Object.entries(remoteStreamsRef.current).map(([id, s]) => ({ peerId: id, stream: s }))
        );
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) socket?.emit("webrtc:ice-candidate", { to: peerId, candidate });
      };

      pc.onconnectionstatechange = () => {
        if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
          delete remoteStreamsRef.current[peerId];
          delete peersRef.current[peerId];
          setRemoteVideos(
            Object.entries(remoteStreamsRef.current).map(([id, s]) => ({ peerId: id, stream: s }))
          );
        }
      };
      return pc;
    },
    [localStream, screenStream, socket]
  );

  // ── Socket olayları ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    socket.on("voice:existing-peers", async ({ peers }) => {
      for (const peerId of peers) {
        const pc = createPC(peerId);
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        socket.emit("webrtc:offer", { to: peerId, offer, channelId });
      }
    });

    socket.on("voice:peer-joined", ({ peerId }) => { createPC(peerId); });

    socket.on("webrtc:offer", async ({ from, offer }) => {
      const pc = createPC(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc:answer", { to: from, answer });
    });

    socket.on("webrtc:answer", async ({ from, answer }) => {
      const pc = peersRef.current[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on("webrtc:ice-candidate", async ({ from, candidate }) => {
      const pc = peersRef.current[from];
      if (pc) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {} }
    });

    socket.on("voice:peer-left", ({ peerId }) => {
      peersRef.current[peerId]?.close();
      delete peersRef.current[peerId];
      delete remoteStreamsRef.current[peerId];
      setRemoteVideos(
        Object.entries(remoteStreamsRef.current).map(([id, s]) => ({ peerId: id, stream: s }))
      );
      if (fullscreenPeer === peerId) setFullscreenPeer(null);
    });

    socket.on("voice:members-update", ({ members: m }) => setMembers(m));

    return () => {
      socket.off("voice:existing-peers");
      socket.off("voice:peer-joined");
      socket.off("webrtc:offer");
      socket.off("webrtc:answer");
      socket.off("webrtc:ice-candidate");
      socket.off("voice:peer-left");
      socket.off("voice:members-update");
    };
  }, [socket, createPC, channelId, fullscreenPeer]);

  // ── Ses seviyesi ayarı ──────────────────────────────────────────────────────
  const setVolume = useCallback((peerId, value) => {
    setVolumes((prev) => ({ ...prev, [peerId]: value }));
    // Web Audio API ile gain ayarla
    const nodes = audioNodesRef.current[peerId];
    if (nodes) {
      nodes.gainNode.gain.value = value;
    }
  }, []);

  // ── Ekran paylaşımı ─────────────────────────────────────────────────────────
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: true,
      });
      setScreenStream(stream);
      setIsSharing(true);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const videoTrack = stream.getVideoTracks()[0];
      Object.values(peersRef.current).forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) sender.replaceTrack(videoTrack);
        else pc.addTrack(videoTrack, stream);
      });
      socket?.emit("voice:toggle-sharing", { channelId });
      videoTrack.onended = () => stopScreenShare();
    } catch (err) {
      if (err.name !== "NotAllowedError") console.error("Ekran paylaşımı hatası:", err);
    }
  };

  const stopScreenShare = () => {
    screenStream?.getTracks().forEach((t) => t.stop());
    setScreenStream(null);
    setIsSharing(false);
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    Object.values(peersRef.current).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) sender.replaceTrack(null).catch(() => {});
    });
    socket?.emit("voice:toggle-sharing", { channelId });
    if (fullscreenPeer === "local") setFullscreenPeer(null);
  };

  const toggleMute = () => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => (t.enabled = isMuted));
    setIsMuted(!isMuted);
    socket?.emit("voice:toggle-mute", { channelId });
  };

  const leaveRoom = () => {
    Object.values(peersRef.current).forEach((pc) => pc.close());
    peersRef.current = {};
    localStream?.getTracks().forEach((t) => t.stop());
    screenStream?.getTracks().forEach((t) => t.stop());
    socket?.emit("voice:leave", { channelId });
    onLeave();
  };

  const hasAnyVideo = isSharing || remoteVideos.some(
    ({ stream }) => stream?.getVideoTracks().length > 0
  );

  return (
    <div className="voice-room">
      {/* Tam ekran overlay */}
      {fullscreenPeer && (
        <FullscreenView
          peerId={fullscreenPeer}
          localVideoRef={fullscreenPeer === "local" ? localVideoRef : null}
          remoteStreams={remoteStreamsRef.current}
          members={members}
          volumes={volumes}
          onSetVolume={setVolume}
          onClose={() => setFullscreenPeer(null)}
          audioNodesRef={audioNodesRef}
        />
      )}

      <div className="voice-header">
        <span className="voice-icon">🔊</span>
        <span className="voice-title">{channelId}</span>
        <span className="voice-status">{status}</span>
      </div>

      {/* Ekran paylaşım önizlemeler */}
      {hasAnyVideo && (
        <div className="voice-videos">
          {isSharing && (
            <div className="voice-video-thumb" onClick={() => setFullscreenPeer("local")}>
              <video ref={localVideoRef} autoPlay muted playsInline className="thumb-video" />
              <div className="thumb-label">📡 Senin paylaşımın</div>
              <div className="thumb-fullscreen">⛶</div>
            </div>
          )}
          {remoteVideos.map(({ peerId, stream }) => {
            const hasVideo = stream?.getVideoTracks().length > 0;
            if (!hasVideo) return null;
            const member = members.find((m) => m.socketId === peerId);
            return (
              <div key={peerId} className="voice-video-thumb" onClick={() => setFullscreenPeer(peerId)}>
                <RemoteVideoThumb stream={stream} peerId={peerId} audioNodesRef={audioNodesRef} volume={volumes[peerId] ?? 1} />
                <div className="thumb-label">{member?.username || "?"}</div>
                <div className="thumb-fullscreen">⛶</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Üye listesi + ses ayarı */}
      <div className="voice-members">
        <div className="voice-members-label">Kanalda ({members.length})</div>
        {members.map((m) => {
          const isMe = m.username === user.username;
          const vol = volumes[m.socketId] ?? 1;
          return (
            <div key={m.socketId} className={`voice-member ${m.sharing ? "sharing" : ""}`}>
              <div className="voice-member-dot" style={{ background: m.muted ? "#555870" : "var(--green)" }} />
              <span className="voice-member-name">
                {m.username}{isMe && " (sen)"}
              </span>
              {m.muted && <span className="voice-badge">🔇</span>}
              {m.sharing && <span className="voice-badge">📡</span>}
              {/* Ses seviyesi — sadece başkaları için */}
              {!isMe && (
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={vol}
                  className="vol-slider"
                  title={`Ses: ${Math.round(vol * 100)}%`}
                  onChange={(e) => setVolume(m.socketId, parseFloat(e.target.value))}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Kontroller */}
      <div className="voice-controls">
        <button className={`voice-btn ${isMuted ? "danger" : ""}`} onClick={toggleMute}>
          {isMuted ? "🔇" : "🎤"}
        </button>
        <button className={`voice-btn ${isSharing ? "active" : ""}`} onClick={isSharing ? stopScreenShare : startScreenShare}>
          {isSharing ? "⏹ Dur" : "🖥 Paylaş"}
        </button>
        <button className="voice-btn leave" onClick={leaveRoom}>📴 Ayrıl</button>
      </div>
    </div>
  );
}

// ── Küçük video thumbnail ────────────────────────────────────────────────────
function RemoteVideoThumb({ stream, peerId, audioNodesRef, volume }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (!videoRef.current || !stream) return;
    videoRef.current.srcObject = stream;

    // Web Audio API ile ses kontrolü
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = volume;
      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      audioNodesRef.current[peerId] = { gainNode, audioCtx };
    } catch {}
  }, [stream]);

  return <video ref={videoRef} autoPlay playsInline className="thumb-video" />;
}

// ── Tam ekran görünüm ────────────────────────────────────────────────────────
function FullscreenView({ peerId, localVideoRef, remoteStreams, members, volumes, onSetVolume, onClose, audioNodesRef }) {
  const videoRef = useRef(null);
  const isLocal = peerId === "local";
  const member = !isLocal ? members.find((m) => m.socketId === peerId) : null;
  const vol = volumes[peerId] ?? 1;

  useEffect(() => {
    if (isLocal) return;
    const stream = remoteStreams[peerId];
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [peerId, isLocal]);

  return (
    <div className="fullscreen-overlay" onClick={onClose}>
      <div className="fullscreen-inner" onClick={(e) => e.stopPropagation()}>
        {isLocal ? (
          <video ref={localVideoRef} autoPlay muted playsInline className="fullscreen-video" />
        ) : (
          <video ref={videoRef} autoPlay playsInline className="fullscreen-video" />
        )}
        <div className="fullscreen-bar">
          <span className="fullscreen-name">
            {isLocal ? "📡 Senin paylaşımın" : (member?.username || "?")}
          </span>
          {!isLocal && (
            <div className="fullscreen-vol">
              <span>🔊</span>
              <input
                type="range" min="0" max="1" step="0.05"
                value={vol}
                onChange={(e) => onSetVolume(peerId, parseFloat(e.target.value))}
                className="vol-slider-lg"
              />
              <span>{Math.round(vol * 100)}%</span>
            </div>
          )}
          <button className="fullscreen-close" onClick={onClose}>✕ Kapat</button>
        </div>
      </div>
    </div>
  );
}
