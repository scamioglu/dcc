import { useState, useEffect, useRef, useCallback } from "react";
import "./VoiceRoom.css";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "turn:a.relay.metered.ca:80",      username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:a.relay.metered.ca:443",     username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:a.relay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
};

/* ── Gizli ses elementi ── */
function RemoteAudio({ stream, volume }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !stream) return;
    ref.current.srcObject = stream;
    ref.current.volume = volume ?? 1;
    ref.current.play().catch(() => {});
  }, [stream]);
  useEffect(() => { if (ref.current) ref.current.volume = volume ?? 1; }, [volume]);
  return <audio ref={ref} autoPlay playsInline style={{ display:"none" }} />;
}

/* ── Küçük video thumbnail ── */
function VideoThumb({ stream, muted }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !stream) return;

    const hasVideo = stream.getVideoTracks().length > 0;
    if (!hasVideo) return;

    ref.current.srcObject = stream;

    const playPromise = ref.current.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {});
    }
  }, [stream]);

  const hasVideo = stream?.getVideoTracks?.().length > 0;

  if (!hasVideo) {
    return (
      <div className="thumb-video thumb-no-video">
        Sesli Kanal
      </div>
    );
  }

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={!!muted}
      className="thumb-video"
    />
  );
}

/* ── OS Tam ekran ── */
function FullscreenView({ peerId, localScreenStream, remoteStreams, members, volumes, onSetVolume, onClose }) {
  const wrapRef  = useRef(null);
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const isLocal  = peerId === "local";
  const stream   = isLocal ? localScreenStream : remoteStreams[peerId];
  const member   = !isLocal ? members.find((m) => m.socketId === peerId) : null;
  const vol      = volumes[peerId] ?? 1;
  const [barVisible, setBarVisible] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      const hasVideo = stream.getVideoTracks().length > 0;

      if (hasVideo) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    }

    if (!isLocal && audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      audioRef.current.volume = vol;
      audioRef.current.play().catch(() => {});
    }
  }, [stream, isLocal, vol]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = vol; }, [vol]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const req = el.requestFullscreen?.bind(el) || el.webkitRequestFullscreen?.bind(el) || el.mozRequestFullScreen?.bind(el);
    req?.().catch(() => {});
    const onChange = () => { if (!document.fullscreenElement && !document.webkitFullscreenElement) onClose(); };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      const exit = document.exitFullscreen?.bind(document) || document.webkitExitFullscreen?.bind(document);
      if (document.fullscreenElement || document.webkitFullscreenElement) exit?.().catch(() => {});
    };
  }, [onClose]);

  const bumpBar = useCallback(() => {
    setBarVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setBarVisible(false), 3000);
  }, []);
  useEffect(() => { bumpBar(); return () => clearTimeout(timerRef.current); }, [bumpBar]);

  return (
    <div ref={wrapRef} className="fs-wrap" onMouseMove={bumpBar} onTouchStart={bumpBar}>
      <video ref={videoRef} autoPlay playsInline muted={isLocal} className="fs-video" />
      {!isLocal && <audio ref={audioRef} autoPlay playsInline style={{ display:"none" }} />}
      <div className={`fs-bar ${barVisible ? "fs-bar-show" : ""}`} onClick={(e) => e.stopPropagation()}>
        <span className="fs-name">{isLocal ? "📡 Senin paylaşımın" : (member?.username || "?")}</span>
        {!isLocal && (
          <div className="fs-vol">
            <span>🔊</span>
            <input type="range" min="0" max="1" step="0.05" value={vol} className="fs-vol-range"
              onChange={(e) => onSetVolume(peerId, parseFloat(e.target.value))} />
            <span className="fs-vol-pct">{Math.round(vol * 100)}%</span>
          </div>
        )}
        <button className="fs-close" onClick={onClose}>✕ Kapat</button>
      </div>
    </div>
  );
}

/* ── Ana bileşen ── */
export default function VoiceRoom({ user, socket, channelId, onLeave }) {
  const [isSharing,      setIsSharing]      = useState(false);
  const [isMuted,        setIsMuted]        = useState(false);
  const [members,        setMembers]        = useState([]);
  const [status,         setStatus]         = useState("Mikrofon bekleniyor...");
  const [fullscreenPeer, setFullscreenPeer] = useState(null);
  const [volumes,        setVolumes]        = useState({});
  const [remoteVideos,   setRemoteVideos]   = useState([]);
  const [isMobile,       setIsMobile]       = useState(false);

  const peersRef         = useRef({});
  const remoteStreamsRef = useRef({});
  const localStreamRef   = useRef(null);
  const screenStreamRef  = useRef(null);

  const refreshVideos = useCallback(() =>
    setRemoteVideos(Object.entries(remoteStreamsRef.current).map(([id, s]) => ({ peerId: id, stream: s }))), []);

  // Mobil kontrolü
  useEffect(() => {
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);

  /* 1. Mikrofon */
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 },
      video: false,
    })
    .then((stream) => {
      localStreamRef.current = stream;
      setStatus("Bağlı ✓");
      socket?.emit("voice:join", { channelId });
    })
    .catch(() => {
      setStatus("⚠ Mikrofon izni yok");
      socket?.emit("voice:join", { channelId });
    });
    return () => {};
  }, []); // eslint-disable-line

  useEffect(() => () => {
    Object.values(peersRef.current).forEach((pc) => pc.close());
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  /* 2. Peer bağlantısı — video transceiver dahil */
  const createPC = useCallback((peerId) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId];
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current[peerId] = pc;

    const mic = localStreamRef.current;

    if (mic && mic.getTracks().length > 0) {
      mic.getTracks().forEach((t) => {
        try {
          pc.addTrack(t, mic);
        } catch (e) {
          console.warn("Track eklenemedi:", e);
        }
      });
    }

    try {
      pc.addTransceiver("audio", { direction: "sendrecv" });
    } catch (err) {
      console.warn("Audio transceiver hatası:", err);
    }
    // Video alabilmek için transceiver aç (ekran paylaşımı gelince hazır olsun)
    try {
      pc.addTransceiver("video", { direction: "recvonly" });
    } catch (err) {
      console.warn("Video transceiver eklenemedi:", err);
    }

    pc.ontrack = ({ track, streams }) => {
      let ms = remoteStreamsRef.current[peerId];

      if (!ms) {
        ms = streams[0] || new MediaStream();
        remoteStreamsRef.current[peerId] = ms;
      }

      const existing = ms.getTracks().find((t) => t.id === track.id);

      if (!existing) {
        ms.addTrack(track);
      }

      track.onended = () => {
        refreshVideos();
      };

      refreshVideos();
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket?.emit("webrtc:ice-candidate", { to: peerId, candidate });
    };

    pc.onconnectionstatechange = () => {
      if (["disconnected","failed","closed"].includes(pc.connectionState)) {
        delete peersRef.current[peerId];
        delete remoteStreamsRef.current[peerId];
        refreshVideos();
      }
    };

    // Renegotiation — ekran paylaşımı gibi track eklenince otomatik offer gönder
    pc.onnegotiationneeded = async () => {
      try {
        if (pc.signalingState !== "stable") return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket?.emit("webrtc:offer", { to: peerId, offer, channelId });
      } catch {}
    };

    return pc;
  }, [socket, channelId, refreshVideos]);

  /* 3. Socket olayları */
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
      if (pc.signalingState !== "stable") return;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc:answer", { to: from, answer });
    });

    socket.on("webrtc:answer", async ({ from, answer }) => {
      const pc = peersRef.current[from];
      if (pc && ["have-local-offer","have-remote-pranswer"].includes(pc.signalingState)) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(() => {});
      }
    });

    socket.on("webrtc:ice-candidate", async ({ from, candidate }) => {
      const pc = peersRef.current[from];
      if (pc) try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    });

    socket.on("voice:peer-left", ({ peerId }) => {
      peersRef.current[peerId]?.close();
      delete peersRef.current[peerId];
      delete remoteStreamsRef.current[peerId];
      refreshVideos();
      if (fullscreenPeer === peerId) setFullscreenPeer(null);
    });

    socket.on("voice:members-update", ({ members: m }) => setMembers(m));

    return () => {
      ["voice:existing-peers","voice:peer-joined","webrtc:offer","webrtc:answer",
       "webrtc:ice-candidate","voice:peer-left","voice:members-update"].forEach((e) => socket.off(e));
    };
  }, [socket, createPC, channelId, fullscreenPeer, refreshVideos]);

  /* 4a. PC ekran paylaşımı (getDisplayMedia) */
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60, max: 60 }, cursor: "always" },
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 48000 },
      });
      await applyShareStream(stream);
    } catch (err) {
      if (err.name !== "NotAllowedError") console.error(err);
    }
  };

  /* 4b. Mobil kamera paylaşımı (getUserMedia video) */
  const startMobileCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      await applyShareStream(stream);
    } catch (err) {
      if (err.name !== "NotAllowedError") console.error(err);
    }
  };

  /* Track'leri tüm peer'lara ekle — renegotiation tetikler */
  const applyShareStream = async (stream) => {
    screenStreamRef.current = stream;
    setIsSharing(true);

    stream.getTracks().forEach((newTrack) => {
      Object.values(peersRef.current).forEach((pc) => {
        // Aynı türde sender var mı?
        const sender = pc.getSenders().find((s) => s.track?.kind === newTrack.kind);
        if (sender) {
          sender.replaceTrack(newTrack);
        } else {
          pc.addTrack(newTrack, stream);
          // addTrack onnegotiationneeded'i tetikler → otomatik offer gider
        }
      });
    });

    socket?.emit("voice:toggle-sharing", { channelId });
    stream.getVideoTracks()[0].onended = () => stopScreenShare();
  };

  const stopScreenShare = () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setIsSharing(false);

    const mic = localStreamRef.current?.getAudioTracks()[0];
    Object.values(peersRef.current).forEach((pc) => {
      pc.getSenders().forEach((s) => {
        if (s.track?.kind === "video") s.replaceTrack(null).catch(() => {});
        if (s.track?.kind === "audio" && mic) s.replaceTrack(mic).catch(() => {});
      });
    });
    socket?.emit("voice:toggle-sharing", { channelId });
    if (fullscreenPeer === "local") setFullscreenPeer(null);
  };

  /* 5. Mikrofon sessiz */
  const toggleMute = () => {
    const mic = localStreamRef.current;
    if (!mic) return;
    const next = !isMuted;
    mic.getAudioTracks().forEach((t) => (t.enabled = !next));
    setIsMuted(next);
    socket?.emit("voice:toggle-mute", { channelId });
  };

  const setVolume = (peerId, value) => setVolumes((p) => ({ ...p, [peerId]: value }));

  const leaveRoom = () => {
    Object.values(peersRef.current).forEach((pc) => pc.close());
    peersRef.current = {};
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    socket?.emit("voice:leave", { channelId });
    onLeave();
  };

  const hasAnyVideo = isSharing ||
    remoteVideos.some(({ stream }) => stream?.getVideoTracks().some((t) => t.readyState === "live"));

  return (
    <>
      {remoteVideos.map(({ peerId, stream }) => (
        <RemoteAudio key={peerId} stream={stream} volume={volumes[peerId] ?? 1} />
      ))}

      {fullscreenPeer && (
        <FullscreenView
          peerId={fullscreenPeer}
          localScreenStream={screenStreamRef.current}
          remoteStreams={remoteStreamsRef.current}
          members={members} volumes={volumes}
          onSetVolume={setVolume}
          onClose={() => setFullscreenPeer(null)}
        />
      )}

      <div className="voice-room">
        <div className="voice-header">
          <span className="voice-icon">🔊</span>
          <span className="voice-title">{channelId}</span>
          <span className={`voice-status ${status.includes("✓") ? "v-ok" : ""}`}>{status}</span>
        </div>

        {hasAnyVideo && (
          <div className="voice-videos">
            {isSharing && (
              <div className="voice-video-thumb" onClick={() => setFullscreenPeer("local")}>
                <VideoThumb stream={screenStreamRef.current} muted />
                <div className="thumb-overlay">
                  <span className="thumb-label">📡 Sen</span>
                  <span className="thumb-fs">⛶</span>
                </div>
              </div>
            )}
            {remoteVideos.map(({ peerId, stream }) => {
              const live = stream?.getVideoTracks().some((t) => t.readyState === "live");
              if (!live) return null;
              const mem = members.find((m) => m.socketId === peerId);
              return (
                <div key={peerId} className="voice-video-thumb" onClick={() => setFullscreenPeer(peerId)}>
                  <VideoThumb stream={stream} muted />
                  <div className="thumb-overlay">
                    <span className="thumb-label">{mem?.username || "?"}</span>
                    <span className="thumb-fs">⛶</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="voice-members">
          <div className="voice-members-label">Kanalda ({members.length})</div>
          {members.map((m) => {
            const isMe = m.username === user.username;
            const vol  = volumes[m.socketId] ?? 1;
            return (
              <div key={m.socketId} className={`voice-member ${m.sharing ? "sharing" : ""}`}>
                <div className="voice-member-dot" style={{ background: m.muted ? "#555870" : "var(--green)" }} />
                <span className="voice-member-name">{m.username}{isMe && " (sen)"}</span>
                {m.muted   && <span className="voice-badge">🔇</span>}
                {m.sharing && <span className="voice-badge">📡</span>}
                {!isMe && (
                  <input type="range" min="0" max="1" step="0.05" value={vol}
                    className="vol-slider" title={`${Math.round(vol*100)}%`}
                    onChange={(e) => setVolume(m.socketId, parseFloat(e.target.value))}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="voice-controls">
          <button className={`voice-btn ${isMuted ? "v-danger" : ""}`} onClick={toggleMute}>
            {isMuted ? "🔇 Sessiz" : "🎤 Açık"}
          </button>

          {/* PC: ekran paylaşımı | Mobil: kamera */}
          {!isMobile ? (
            <button className={`voice-btn ${isSharing ? "v-active" : ""}`}
              onClick={isSharing ? stopScreenShare : startScreenShare}>
              {isSharing ? "⏹ Dur" : "🖥 Paylaş"}
            </button>
          ) : (
            <button className={`voice-btn ${isSharing ? "v-active" : ""}`}
              onClick={isSharing ? stopScreenShare : startMobileCamera}>
              {isSharing ? "⏹ Dur" : "📷 Kamera"}
            </button>
          )}

          <button className="voice-btn v-leave" onClick={leaveRoom}>📴 Ayrıl</button>
        </div>
      </div>
    </>
  );
}
