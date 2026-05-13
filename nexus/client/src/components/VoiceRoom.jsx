import { useState, useEffect, useRef, useCallback } from "react";
import { useWebRTC } from "../hooks/useWebRTC.js";
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

  const localVideoRef = useRef(null);
  const peersRef = useRef({}); // peerId -> RTCPeerConnection
  const remoteStreamsRef = useRef({}); // peerId -> MediaStream
  const [remoteVideos, setRemoteVideos] = useState([]); // [{ peerId, stream }]

  // ── Lokal ses al ────────────────────────────────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        setLocalStream(stream);
        setStatus("Bağlanıyor...");
        socket?.emit("voice:join", { channelId });
      })
      .catch(() => {
        setStatus("Mikrofon erişimi reddedildi. Yine de bağlanılıyor...");
        socket?.emit("voice:join", { channelId });
      });

    return () => {
      localStream?.getTracks().forEach((t) => t.stop());
      screenStream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Peer bağlantısı kur ─────────────────────────────────────────────────────
  const createPC = useCallback(
    (peerId) => {
      if (peersRef.current[peerId]) return peersRef.current[peerId];

      const pc = new RTCPeerConnection(ICE_SERVERS);
      peersRef.current[peerId] = pc;

      // Lokal ses ekle
      const activeStream = screenStream || localStream;
      activeStream?.getTracks().forEach((t) => pc.addTrack(t, activeStream));

      pc.ontrack = ({ streams }) => {
        remoteStreamsRef.current[peerId] = streams[0];
        setRemoteVideos(
          Object.entries(remoteStreamsRef.current).map(([id, s]) => ({
            peerId: id,
            stream: s,
          }))
        );
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          socket?.emit("webrtc:ice-candidate", { to: peerId, candidate });
        }
      };

      pc.onconnectionstatechange = () => {
        if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
          delete remoteStreamsRef.current[peerId];
          delete peersRef.current[peerId];
          setRemoteVideos(
            Object.entries(remoteStreamsRef.current).map(([id, s]) => ({
              peerId: id,
              stream: s,
            }))
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

    // Mevcut peer'lara offer gönder
    socket.on("voice:existing-peers", async ({ peers }) => {
      setStatus("Bağlı");
      for (const peerId of peers) {
        const pc = createPC(peerId);
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        socket.emit("webrtc:offer", { to: peerId, offer, channelId });
      }
    });

    // Yeni biri geldi → offer gelmesini bekle
    socket.on("voice:peer-joined", ({ peerId }) => {
      createPC(peerId); // sadece bağlantıyı hazırla
    });

    // Offer aldık → answer gönder
    socket.on("webrtc:offer", async ({ from, offer }) => {
      const pc = createPC(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc:answer", { to: from, answer });
    });

    // Answer aldık
    socket.on("webrtc:answer", async ({ from, answer }) => {
      const pc = peersRef.current[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    // ICE candidate
    socket.on("webrtc:ice-candidate", async ({ from, candidate }) => {
      const pc = peersRef.current[from];
      if (pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      }
    });

    // Biri ayrıldı
    socket.on("voice:peer-left", ({ peerId }) => {
      peersRef.current[peerId]?.close();
      delete peersRef.current[peerId];
      delete remoteStreamsRef.current[peerId];
      setRemoteVideos(
        Object.entries(remoteStreamsRef.current).map(([id, s]) => ({ peerId: id, stream: s }))
      );
    });

    // Üye listesi
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
  }, [socket, createPC, channelId]);

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

      // Tüm peer bağlantılarındaki video track'i değiştir
      const videoTrack = stream.getVideoTracks()[0];
      Object.values(peersRef.current).forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) sender.replaceTrack(videoTrack);
        else pc.addTrack(videoTrack, stream);
      });

      socket?.emit("voice:toggle-sharing", { channelId });

      // Kullanıcı tarayıcıdan durdurursa
      videoTrack.onended = () => stopScreenShare();
    } catch (err) {
      if (err.name !== "NotAllowedError") {
        console.error("Ekran paylaşımı hatası:", err);
      }
    }
  };

  const stopScreenShare = () => {
    screenStream?.getTracks().forEach((t) => t.stop());
    setScreenStream(null);
    setIsSharing(false);
    if (localVideoRef.current) localVideoRef.current.srcObject = null;

    // Video track'i kaldır
    Object.values(peersRef.current).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) sender.replaceTrack(null).catch(() => {});
    });

    socket?.emit("voice:toggle-sharing", { channelId });
  };

  // ── Mikrofon sessize al ─────────────────────────────────────────────────────
  const toggleMute = () => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => (t.enabled = isMuted));
    setIsMuted(!isMuted);
    socket?.emit("voice:toggle-mute", { channelId });
  };

  // ── Odadan ayrıl ───────────────────────────────────────────────────────────
  const leaveRoom = () => {
    Object.values(peersRef.current).forEach((pc) => pc.close());
    peersRef.current = {};
    localStream?.getTracks().forEach((t) => t.stop());
    screenStream?.getTracks().forEach((t) => t.stop());
    socket?.emit("voice:leave", { channelId });
    onLeave();
  };

  return (
    <div className="voice-room">
      <div className="voice-header">
        <span className="voice-icon">🔊</span>
        <span className="voice-title">{channelId}</span>
        <span className="voice-status">{status}</span>
      </div>

      {/* Ekran paylaşım önizleme */}
      {isSharing && (
        <div className="voice-screen-preview">
          <video ref={localVideoRef} autoPlay muted playsInline className="screen-video" />
          <div className="screen-badge">📡 Senin paylaşımın</div>
        </div>
      )}

      {/* Uzak ekranlar */}
      {remoteVideos.map(({ peerId, stream }) => (
        <RemoteVideo key={peerId} peerId={peerId} stream={stream} members={members} />
      ))}

      {/* Üyeler */}
      <div className="voice-members">
        <div className="voice-members-label">Kanalda ({members.length})</div>
        {members.map((m) => (
          <div key={m.socketId} className={`voice-member ${m.sharing ? "sharing" : ""}`}>
            <div className="voice-member-dot" style={{ background: m.muted ? "#555870" : "var(--green)" }} />
            <span className="voice-member-name">
              {m.username}
              {m.username === user.username && " (sen)"}
            </span>
            {m.muted && <span className="voice-badge muted">🔇</span>}
            {m.sharing && <span className="voice-badge share">📡 paylaşıyor</span>}
          </div>
        ))}
      </div>

      {/* Kontroller */}
      <div className="voice-controls">
        <button
          className={`voice-btn ${isMuted ? "danger" : ""}`}
          onClick={toggleMute}
          title={isMuted ? "Sesi Aç" : "Sesi Kapat"}
        >
          {isMuted ? "🔇" : "🎤"}
        </button>
        <button
          className={`voice-btn ${isSharing ? "active" : ""}`}
          onClick={isSharing ? stopScreenShare : startScreenShare}
          title={isSharing ? "Paylaşımı Durdur" : "Ekran Paylaş (1080p)"}
        >
          {isSharing ? "⏹ Durdur" : "🖥 Paylaş"}
        </button>
        <button className="voice-btn leave" onClick={leaveRoom} title="Odadan Ayrıl">
          📴 Ayrıl
        </button>
      </div>
    </div>
  );
}

function RemoteVideo({ peerId, stream, members }) {
  const videoRef = useRef(null);
  const member = members.find((m) => m.socketId === peerId);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const hasVideo = stream?.getVideoTracks().length > 0;

  if (!hasVideo) return null;

  return (
    <div className="remote-video-wrapper">
      <video ref={videoRef} autoPlay playsInline className="screen-video" />
      <div className="remote-video-label">{member?.username || peerId.slice(0, 6)}</div>
    </div>
  );
}
