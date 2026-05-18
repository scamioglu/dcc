import { useState, useEffect, useRef, useCallback } from "react";
import "./VoiceRoom.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";

const STUN_ONLY = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "turn:a.relay.metered.ca:80",               username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:a.relay.metered.ca:443",              username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:a.relay.metered.ca:443?transport=tcp",username: "openrelayproject", credential: "openrelayproject" },
  ],
};

const COLORS = ["#4f5fcc","#1D9E75","#D85A30","#BA7517","#534AB7","#0F6E56"];
function avatarColor(name) {
  let h = 0;
  for (const c of (name||"?")) h = (h*31+c.charCodeAt(0))%COLORS.length;
  return COLORS[h];
}

function playNotif(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const g = ctx.createGain(); g.gain.value = 0.15; g.connect(ctx.destination);
    const tone = (f1,f2,t0,dur) => {
      const o=ctx.createOscillator(), e=ctx.createGain();
      o.type="sine"; o.frequency.setValueAtTime(f1,t0); o.frequency.linearRampToValueAtTime(f2,t0+dur*0.7);
      e.gain.setValueAtTime(0,t0); e.gain.linearRampToValueAtTime(1,t0+0.01); e.gain.linearRampToValueAtTime(0,t0+dur);
      o.connect(e); e.connect(g); o.start(t0); o.stop(t0+dur+0.05);
    };
    const t=ctx.currentTime;
    if(type==="join"){tone(523,784,t,0.14);tone(784,1047,t+0.15,0.14);}
    else{tone(784,523,t,0.10);tone(523,392,t+0.11,0.14);}
    setTimeout(()=>ctx.close(),1500);
  } catch {}
}

/* ── Ses elementi — kişi sesi için ── */
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

/* ── Yayın ses elementi — ayrı audio context ── */
function StreamAudio({ stream, volume }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !stream) return;
    // Sadece audio track'leri içeren yeni bir stream oluştur
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return;
    const audioStream = new MediaStream(audioTracks);
    ref.current.srcObject = audioStream;
    ref.current.volume = volume ?? 1;
    ref.current.play().catch(() => {});
  }, [stream]);
  useEffect(() => { if (ref.current) ref.current.volume = volume ?? 1; }, [volume]);
  return <audio ref={ref} autoPlay playsInline style={{ display:"none" }} />;
}

/* ── Video thumbnail — yayın sesi ayrı StreamAudio'dan, burada muted ── */
function VideoThumb({ stream, muted }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !stream) return;
    ref.current.srcObject = stream;
    ref.current.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={!!muted} className="thumb-video" />;
}

/* ── Tam ekran ── */
function FullscreenView({ peerId, localScreenStream, remoteStreams, members, streamVolumes, onSetStreamVolume, onClose }) {
  const wrapRef  = useRef(null);
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const isLocal  = peerId === "local";
  const stream   = isLocal ? localScreenStream : remoteStreams[peerId];
  const member   = members.find((m) => m.socketId === peerId);
  const vol      = streamVolumes[peerId] ?? 1;
  const [barVisible, setBarVisible] = useState(true);
  const timerRef = useRef(null);
  const isMobile = useRef(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)).current;

  const attachStream = useCallback(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    // Fullscreen'de yayın sesini de burada yönet
    if (!isLocal && audioRef.current && stream) {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length) {
        const audioStream = new MediaStream(audioTracks);
        audioRef.current.srcObject = audioStream;
        audioRef.current.volume = vol;
        audioRef.current.play().catch(() => {});
      }
    }
  }, [stream, isLocal, vol]);

  useEffect(() => { attachStream(); }, [attachStream]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = vol; }, [vol]);

  // Orientation change — siyah ekran fix
  useEffect(() => {
    if (!isMobile) return;
    let rafId;
    const reattach = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (videoRef.current && stream) {
          videoRef.current.srcObject = null;
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    };
    window.addEventListener("resize", reattach);
    window.addEventListener("orientationchange", reattach);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", reattach);
      window.removeEventListener("orientationchange", reattach);
    };
  }, [isMobile, stream]);

  useEffect(() => {
    if (isMobile) return;
    const el = wrapRef.current;
    if (!el) return;
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el).catch(() => {});
    const onFsChange = () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) onClose();
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document).catch(() => {});
      }
    };
  }, [onClose, isMobile]);

  const bumpBar = useCallback(() => {
    setBarVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setBarVisible(false), isMobile ? 5000 : 3000);
  }, [isMobile]);
  useEffect(() => { bumpBar(); return () => clearTimeout(timerRef.current); }, [bumpBar]);

  return (
    <div ref={wrapRef} className={`fs-wrap${isMobile ? " fs-mobile" : ""}`}
      onMouseMove={bumpBar} onTouchStart={bumpBar}>
      <video ref={videoRef} autoPlay playsInline muted className="fs-video" />
      {/* Fullscreen'de yayın sesi — StreamAudio'dan bağımsız */}
      {!isLocal && <audio ref={audioRef} autoPlay playsInline style={{ display:"none" }} />}
      <div className={`fs-bar${barVisible ? " fs-bar-show" : ""}${isMobile ? " fs-bar-mobile" : ""}`}
        onClick={(e) => e.stopPropagation()}>
        <span className="fs-name">{isLocal ? "📡 Senin paylaşımın" : (member?.username || "?")}</span>
        {!isLocal && (
          <div className="fs-vol" onClick={(e) => e.stopPropagation()}>
            <span>📺</span>
            <input type="range" min="0" max="1" step="0.05" value={vol}
              className="fs-vol-range"
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => onSetStreamVolume(peerId, parseFloat(e.target.value))} />
            <span className="fs-vol-pct">{Math.round(vol * 100)}%</span>
          </div>
        )}
        <button className="fs-close" onClick={onClose}>✕ Kapat</button>
      </div>
    </div>
  );
}

/* ══ ANA BİLEŞEN ══ */
export default function VoiceRoom({ user, socket, channelId, onLeave }) {
  const [isSharing,      setIsSharing]      = useState(false);
  const [isMuted,        setIsMuted]        = useState(false);
  const [members,        setMembers]        = useState([]);
  const [status,         setStatus]         = useState("Bağlanıyor...");
  const [fullscreenPeer, setFullscreenPeer] = useState(null);
  // Kişi sesi (mikrofon) ve yayın sesi ayrı
  const [voiceVolumes,  setVoiceVolumes]    = useState({}); // socketId -> 0-1
  const [streamVolumes, setStreamVolumes]   = useState({}); // socketId -> 0-1 (ekran paylaşımı sesi)
  const [remoteVideos,  setRemoteVideos]    = useState([]);
  const [screenStream,  setScreenStream]    = useState(null);

  const iceServersRef    = useRef(STUN_ONLY);
  const peersRef         = useRef({});
  const remoteStreamsRef = useRef({});
  const localStreamRef   = useRef(null);
  const screenStreamRef  = useRef(null);
  const audioCtxRef      = useRef(null);
  const socketRef        = useRef(socket);

  useEffect(() => { socketRef.current = socket; }, [socket]);

  const refreshVideos = useCallback(() =>
    setRemoteVideos(Object.entries(remoteStreamsRef.current).map(([id,s])=>({peerId:id,stream:s}))), []);

  /* ICE sunucuları */
  useEffect(() => {
    fetch(`${SERVER_URL}/api/ice-servers`)
      .then(r => r.json())
      .then(({ iceServers }) => { if (Array.isArray(iceServers) && iceServers.length) iceServersRef.current = { iceServers }; })
      .catch(() => {});
  }, []);

  /* ── MİKROFON — Discord kalitesi ──
     Sorun: Web Audio kompresör + AGC = boğuk ses
     Çözüm: Sadece browser constraint'ları, sade zincir, AGC açık (Discord da açık bırakır)
  */
  useEffect(() => {
    if (!socket) return;
    let rawStream = null;

    navigator.mediaDevices.getUserMedia({
      audio: {
        // Temel gürültü bastırma — tarayıcının kendi AI modeli
        echoCancellation:  true,
        noiseSuppression:  true,
        autoGainControl:   true,   // AGC açık = ses seviyesi sabit, boğulma yok
        sampleRate:        48000,
        channelCount:      1,
        // Chrome-specific — çalışmayanlarda hata değil uyarı
        googEchoCancellation:    true,
        googNoiseSuppression:    true,
        googHighpassFilter:      true,
        googNoiseSuppression2:   true,
        googEchoCancellation2:   true,
        googDAEchoCancellation:  true,
        googAutoGainControl:     true,
        googTypingNoiseDetection:true,
      },
      video: false,
    })
    .then((stream) => {
      rawStream = stream;

      /* Tek işlem: HighPass filtresi (120Hz altı ortam gürültüsü keser)
         Kompresör KALDIRILDI — boğukluğun kaynağıydı */
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      audioCtxRef.current = ctx;
      const src  = ctx.createMediaStreamSource(stream);
      const hi   = ctx.createBiquadFilter();
      hi.type = "highpass"; hi.frequency.value = 80; hi.Q.value = 0.7;
      const dest = ctx.createMediaStreamDestination();
      src.connect(hi); hi.connect(dest);

      localStreamRef.current = dest.stream;
      setStatus("Bağlı ✓");
      socket.emit("voice:join", { channelId });
    })
    .catch(() => {
      setStatus("⚠ Mikrofon izni yok");
      socket.emit("voice:join", { channelId });
    });

    return () => { rawStream?.getTracks().forEach(t => t.stop()); };
  }, [socket, channelId]);

  /* Cleanup */
  useEffect(() => {
    return () => {
      Object.values(peersRef.current).forEach(pc => pc.close());
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close();
      socketRef.current?.emit("voice:leave", { channelId });
    };
  }, [channelId]);

  /* ── PEER BAĞLANTISI ── */
  const createPC = useCallback((peerId) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId];
    const pc = new RTCPeerConnection({
      ...iceServersRef.current,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });
    peersRef.current[peerId] = pc;

    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    screenStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, screenStreamRef.current));

    pc.ontrack = ({ track, streams }) => {
      let ms = remoteStreamsRef.current[peerId];
      if (!ms) { ms = streams[0] || new MediaStream(); remoteStreamsRef.current[peerId] = ms; }
      ms.getTracks().filter(t => t.kind === track.kind).forEach(t => ms.removeTrack(t));
      ms.addTrack(track);
      track.onended = refreshVideos;
      refreshVideos();
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socketRef.current?.emit("webrtc:ice-candidate", { to: peerId, candidate });
    };

    pc.oniceconnectionstatechange = async () => {
      if (pc.iceConnectionState === "failed") { try { await pc.restartIce(); } catch {} }
    };

    pc.onconnectionstatechange = () => {
      if (["disconnected","failed","closed"].includes(pc.connectionState)) {
        delete peersRef.current[peerId];
        delete remoteStreamsRef.current[peerId];
        refreshVideos();
      }
    };

    return pc;
  }, [refreshVideos]);

  /* ── YÜKSEK KALİTE BİTRATE — Twitch/Kick seviyesi ──
     4Mbps video + agresif encoder = keskin görüntü, düşük blur */
  const applyVideoQuality = useCallback(async (pc) => {
    const sender = pc.getSenders().find(s => s.track?.kind === "video");
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings.forEach(enc => {
        enc.maxBitrate      = 6_000_000; // 6Mbps — 1080p/30fps için yeterli
        enc.maxFramerate    = 30;
        enc.networkPriority = "high";
        enc.priority        = "high";
        enc.scaleResolutionDownBy = 1.0; // küçültme yok
      });
      await sender.setParameters(params);
    } catch {}
  }, []);

  /* ── SOCKET OLAYLARI ── */
  useEffect(() => {
    if (!socket) return;

    socket.on("voice:existing-peers", async ({ peers }) => {
      for (const peerId of peers) {
        const pc = createPC(peerId);
        const offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
        await pc.setLocalDescription(offer);
        socket.emit("webrtc:offer", { to: peerId, offer, channelId });
      }
    });

    socket.on("voice:peer-joined", ({ peerId }) => { createPC(peerId); playNotif("join"); });

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
      if (pc && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(() => {});
        if (screenStreamRef.current) applyVideoQuality(pc);
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
      playNotif("leave");
    });

    socket.on("voice:members-update", ({ members: m }) => setMembers(m));

    return () => {
      ["voice:existing-peers","voice:peer-joined","webrtc:offer","webrtc:answer",
       "webrtc:ice-candidate","voice:peer-left","voice:members-update"].forEach(e => socket.off(e));
    };
  }, [socket, createPC, channelId, fullscreenPeer, refreshVideos, applyVideoQuality]);

  /* ── EKRAN PAYLAŞIMI ── */
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width:          { ideal: 1920 },
          height:         { ideal: 1080 },
          frameRate:      { ideal: 30 },  // 30fps = daha düşük encode gecikmesi, daha yüksek kalite
          cursor:         "always",
          displaySurface: "monitor",
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
          sampleRate:       48000,
        },
        selfBrowserSurface: "include",
        systemAudio:        "include",
      }).catch(async () =>
        navigator.mediaDevices.getDisplayMedia({
          video: { width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30}, cursor:"always" },
          audio: true,
        })
      );

      // "motion" = akıcılık öncelikli (oyun için)
      // "detail" = keskinlik öncelikli (metin/kod için)
      // Oyun yayını için "motion" → bulanıklık azalır çünkü tarayıcı blur yerine frame drop seçer
      stream.getVideoTracks().forEach(t => { if ("contentHint" in t) t.contentHint = "motion"; });

      screenStreamRef.current = stream;
      setScreenStream(stream);
      setIsSharing(true);

      stream.getTracks().forEach(newTrack => {
        Object.values(peersRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === newTrack.kind);
          if (sender) sender.replaceTrack(newTrack);
          else pc.addTrack(newTrack, stream);
        });
      });

      // Renegotiation + kalite ayarı
      await Promise.all(Object.entries(peersRef.current).map(async ([peerId, pc]) => {
        try {
          if (pc.signalingState !== "stable") return;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket?.emit("webrtc:offer", { to: peerId, offer, channelId });
          await applyVideoQuality(pc);
        } catch {}
      }));

      socket?.emit("voice:toggle-sharing", { channelId });
      stream.getVideoTracks()[0].onended = () => stopScreenShare();
    } catch (err) {
      if (err.name !== "NotAllowedError") console.error(err);
    }
  };

  const stopScreenShare = () => {
    const stream = screenStreamRef.current;
    if (!stream) return;
    screenStreamRef.current = null;
    stream.getTracks().forEach(t => t.stop());
    setScreenStream(null);
    setIsSharing(false);
    const mic = localStreamRef.current?.getAudioTracks()[0];
    Object.values(peersRef.current).forEach(pc => {
      pc.getSenders().forEach(s => {
        if (s.track?.kind === "video") s.replaceTrack(null).catch(() => {});
        if (s.track?.kind === "audio" && mic) s.replaceTrack(mic).catch(() => {});
      });
    });
    socket?.emit("voice:toggle-sharing", { channelId });
    if (fullscreenPeer === "local") setFullscreenPeer(null);
  };

  const toggleMute = () => {
    const mic = localStreamRef.current;
    if (!mic) return;
    const next = !isMuted;
    mic.getAudioTracks().forEach(t => t.enabled = !next);
    setIsMuted(next);
    socket?.emit("voice:toggle-mute", { channelId });
  };

  const leaveRoom = () => {
    Object.values(peersRef.current).forEach(pc => pc.close());
    peersRef.current = {};
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close();
    socket?.emit("voice:leave", { channelId });
    onLeave();
  };

  const hasVideo = isSharing ||
    remoteVideos.some(({stream}) => stream?.getVideoTracks().some(t => t.readyState === "live"));

  return (
    <>
      {/* Kişi sesi — sadece mic track */}
      {remoteVideos.map(({ peerId, stream }) => {
        const audioOnly = new MediaStream(stream?.getAudioTracks() || []);
        return <RemoteAudio key={peerId} stream={audioOnly} volume={voiceVolumes[peerId] ?? 1} />;
      })}

      {/* Yayın sesi — sadece ekran paylaşımı olan peer'lar */}
      {remoteVideos.map(({ peerId, stream }) => {
        const hasVideoTrack = stream?.getVideoTracks().some(t => t.readyState === "live");
        if (!hasVideoTrack) return null;
        return <StreamAudio key={`sv-${peerId}`} stream={stream} volume={streamVolumes[peerId] ?? 1} />;
      })}

      {/* Tam ekran */}
      {fullscreenPeer && (
        <FullscreenView
          peerId={fullscreenPeer}
          localScreenStream={screenStream}
          remoteStreams={remoteStreamsRef.current}
          members={members}
          streamVolumes={streamVolumes}
          onSetStreamVolume={(id,v) => setStreamVolumes(p => ({...p,[id]:v}))}
          onClose={() => setFullscreenPeer(null)}
        />
      )}

      <div className="voice-room">
        <div className="voice-header">
          <span className="voice-dot" />
          <span className="voice-title">{channelId}</span>
          <span className={`voice-status ${status.includes("✓") ? "v-ok" : ""}`}>{status}</span>
        </div>

        {/* Video önizlemeler */}
        {hasVideo && (
          <div className="voice-videos">
            {isSharing && (
              <div className="voice-video-thumb" onClick={() => setFullscreenPeer("local")}>
                <VideoThumb stream={screenStream} muted />
                <div className="thumb-overlay">
                  <span className="thumb-label">📡 Sen</span>
                  <span className="thumb-fs">⛶</span>
                </div>
              </div>
            )}
            {remoteVideos.map(({ peerId, stream }) => {
              const live = stream?.getVideoTracks().some(t => t.readyState === "live");
              if (!live) return null;
              const mem = members.find(m => m.socketId === peerId);
              const svol = streamVolumes[peerId] ?? 1;
              return (
                <div key={peerId} className="voice-video-thumb" onClick={() => setFullscreenPeer(peerId)}>
                  <VideoThumb stream={stream} muted />
                  <div className="thumb-overlay">
                    <span className="thumb-label">{mem?.username || "?"}</span>
                    <span className="thumb-fs">⛶</span>
                  </div>
                  {/* Yayın ses slider — tıklamayı engelle, fullscreen açılmasın */}
                  <div className="thumb-vol" onClick={e => e.stopPropagation()}>
                    <span>📺</span>
                    <input type="range" min="0" max="1" step="0.05" value={svol}
                      className="thumb-vol-range"
                      onPointerDown={e => e.stopPropagation()}
                      onChange={e => setStreamVolumes(p => ({...p,[peerId]:parseFloat(e.target.value)}))} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Üyeler — kişi ses ayarı buraya */}
        <div className="voice-members">
          <div className="voice-members-label">Kanalda ({members.length})</div>
          {members.map(m => {
            const isMe = m.username === user.username;
            const vvol = voiceVolumes[m.socketId] ?? 1;
            return (
              <div key={m.socketId} className={`voice-member ${m.sharing ? "sharing" : ""}`}>
                <div className="voice-member-avatar" style={{ background: avatarColor(m.username) }}>
                  {m.username.slice(0,2).toUpperCase()}
                </div>
                <div className="voice-member-info">
                  <span className="voice-member-name">{m.username}{isMe && " (sen)"}</span>
                  {!isMe && (
                    <div className="voice-vol-row" onClick={e => e.stopPropagation()}>
                      <span className="vol-icon">🎤</span>
                      <input type="range" min="0" max="1" step="0.05" value={vvol}
                        className="vol-slider"
                        onPointerDown={e => e.stopPropagation()}
                        onChange={e => setVoiceVolumes(p => ({...p,[m.socketId]:parseFloat(e.target.value)}))} />
                      <span className="vol-pct">{Math.round(vvol*100)}%</span>
                    </div>
                  )}
                </div>
                <div className="voice-member-badges">
                  {m.muted   && <span className="voice-badge">🔇</span>}
                  {m.sharing && <span className="voice-badge">📡</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="voice-controls">
          <button className={`voice-btn ${isMuted ? "v-danger" : ""}`} onClick={toggleMute}
            title={isMuted ? "Sesi Aç" : "Sessize Al"}>
            {isMuted ? "🔇" : "🎤"}
            <span className="vbtn-label">{isMuted ? "Sessiz" : "Açık"}</span>
          </button>
          <button className={`voice-btn ${isSharing ? "v-active" : ""}`}
            onClick={isSharing ? stopScreenShare : startScreenShare}
            title={isSharing ? "Paylaşımı Durdur" : "Ekran Paylaş"}>
            🖥
            <span className="vbtn-label">{isSharing ? "Durdur" : "Paylaş"}</span>
          </button>
          <button className="voice-btn v-leave" onClick={leaveRoom} title="Kanaldan Ayrıl">
            📴
            <span className="vbtn-label">Ayrıl</span>
          </button>
        </div>
      </div>
    </>
  );
}
