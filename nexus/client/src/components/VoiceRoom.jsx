import { useState, useEffect, useRef, useCallback } from "react";
import "./VoiceRoom.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "turn:a.relay.metered.ca:80",                username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:a.relay.metered.ca:443",               username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:a.relay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

const COLORS = ["#4f5fcc","#1D9E75","#D85A30","#BA7517","#534AB7","#0F6E56"];
function avatarColor(n) {
  let h=0; for (const c of (n||"?")) h=(h*31+c.charCodeAt(0))%COLORS.length; return COLORS[h];
}

function playNotif(type) {
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const g = ctx.createGain(); g.gain.value=0.12; g.connect(ctx.destination);
    const tone=(f1,f2,t0,d)=>{const o=ctx.createOscillator(),e=ctx.createGain();o.type="sine";o.frequency.setValueAtTime(f1,t0);o.frequency.linearRampToValueAtTime(f2,t0+d*0.7);e.gain.setValueAtTime(0,t0);e.gain.linearRampToValueAtTime(1,t0+0.01);e.gain.linearRampToValueAtTime(0,t0+d);o.connect(e);e.connect(g);o.start(t0);o.stop(t0+d+0.05);};
    const t=ctx.currentTime;
    if(type==="join"){tone(523,784,t,0.14);tone(784,1047,t+0.15,0.14);}
    else{tone(784,523,t,0.10);tone(523,392,t+0.11,0.14);}
    setTimeout(()=>ctx.close(),1500);
  } catch {}
}

/* ── Uzak kişi sesi (sadece audio track) ── */
function RemoteAudio({ stream, volume }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !stream) return;
    // Sadece audio track içeren temiz stream
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return;
    const s = new MediaStream(audioTracks);
    ref.current.srcObject = s;
    ref.current.volume = volume ?? 1;
    ref.current.play().catch(()=>{});
  }, [stream]);
  useEffect(() => { if (ref.current) ref.current.volume = volume ?? 1; }, [volume]);
  return <audio ref={ref} autoPlay playsInline style={{display:"none"}} />;
}

/* ── Yayın sesi (ekran paylaşımı audio) ── */
function StreamAudio({ stream, volume }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !stream) return;
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return;
    const s = new MediaStream(audioTracks);
    ref.current.srcObject = s;
    ref.current.volume = volume ?? 1;
    ref.current.play().catch(()=>{});
  }, [stream]);
  useEffect(() => { if (ref.current) ref.current.volume = volume ?? 1; }, [volume]);
  return <audio ref={ref} autoPlay playsInline style={{display:"none"}} />;
}

/* ── Video thumbnail ── */
function VideoThumb({ stream, muted }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) { ref.current.srcObject = stream; ref.current.play().catch(()=>{}); }
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
  const member   = members.find(m => m.socketId === peerId);
  const vol      = streamVolumes[peerId] ?? 1;
  const [barVisible, setBarVisible] = useState(true);
  const timerRef = useRef(null);
  const isMobile = useRef(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)).current;

  useEffect(() => {
    if (videoRef.current && stream) { videoRef.current.srcObject = stream; videoRef.current.play().catch(()=>{}); }
    if (!isLocal && audioRef.current && stream) {
      const at = stream.getAudioTracks();
      if (at.length) {
        audioRef.current.srcObject = new MediaStream(at);
        audioRef.current.volume = vol;
        audioRef.current.play().catch(()=>{});
      }
    }
  }, [stream, isLocal]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = vol; }, [vol]);

  // Orientation fix
  useEffect(() => {
    if (!isMobile) return;
    let raf;
    const reattach = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      if (videoRef.current && stream) { videoRef.current.srcObject=null; videoRef.current.srcObject=stream; videoRef.current.play().catch(()=>{}); }
    });};
    window.addEventListener("resize", reattach);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", reattach); };
  }, [isMobile, stream]);

  // OS fullscreen (desktop only)
  useEffect(() => {
    if (isMobile) return;
    const el = wrapRef.current; if (!el) return;
    (el.requestFullscreen||el.webkitRequestFullscreen)?.call(el).catch(()=>{});
    const onChange = () => { if (!document.fullscreenElement && !document.webkitFullscreenElement) onClose(); };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      if (document.fullscreenElement||document.webkitFullscreenElement)
        (document.exitFullscreen||document.webkitExitFullscreen)?.call(document).catch(()=>{});
    };
  }, [onClose, isMobile]);

  const bumpBar = useCallback(() => {
    setBarVisible(true); clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setBarVisible(false), isMobile ? 5000 : 3000);
  }, [isMobile]);
  useEffect(() => { bumpBar(); return () => clearTimeout(timerRef.current); }, [bumpBar]);

  return (
    <div ref={wrapRef} className={`fs-wrap${isMobile?" fs-mobile":""}`}
      onMouseMove={bumpBar} onTouchStart={bumpBar}>
      <video ref={videoRef} autoPlay playsInline muted className="fs-video" />
      {!isLocal && <audio ref={audioRef} autoPlay playsInline style={{display:"none"}} />}
      <div className={`fs-bar${barVisible?" fs-bar-show":""}${isMobile?" fs-bar-mobile":""}`}>
        <span className="fs-name">{isLocal ? "📡 Senin paylaşımın" : (member?.username||"?")}</span>
        {!isLocal && (
          // stopPropagation — video tıklamayı engelle
          <div className="fs-vol" onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
            <span>📺</span>
            <input type="range" min="0" max="1" step="0.05" value={vol} className="fs-vol-range"
              onChange={e => onSetStreamVolume(peerId, parseFloat(e.target.value))} />
            <span className="fs-vol-pct">{Math.round(vol*100)}%</span>
          </div>
        )}
        <button className="fs-close" onClick={onClose}>✕ Kapat</button>
      </div>
    </div>
  );
}

/* ══ ANA BİLEŞEN ══ */
export default function VoiceRoom({ user, socket, channelId, onLeave }) {
  const [isSharing,     setIsSharing]     = useState(false);
  const [isMuted,       setIsMuted]       = useState(false);
  const [members,       setMembers]       = useState([]);
  const [status,        setStatus]        = useState("Bağlanıyor...");
  const [fullscreenPeer,setFullscreenPeer]= useState(null);
  const [voiceVolumes,  setVoiceVolumes]  = useState({});   // 🎤 kişi sesi
  const [streamVolumes, setStreamVolumes] = useState({});   // 📺 yayın sesi
  const [remoteVideos,  setRemoteVideos]  = useState([]);
  const [screenStream,  setScreenStream]  = useState(null);

  const peersRef         = useRef({});
  const remoteStreamsRef = useRef({});
  const localStreamRef   = useRef(null);
  const screenStreamRef  = useRef(null);
  const audioCtxRef      = useRef(null);
  const rawStreamRef     = useRef(null);
  const socketRef        = useRef(socket);
  useEffect(() => { socketRef.current = socket; }, [socket]);

  const refreshVideos = useCallback(() =>
    setRemoteVideos(Object.entries(remoteStreamsRef.current).map(([id,s])=>({peerId:id,stream:s}))), []);

  /* ── MİKROFON — Noise Gate ile ──
     Noise Gate: belirli bir eşiğin altındaki sesi tamamen keser.
     Kompresördan farkı: sesi ezmez, ya tam geçirir ya tamamen keser.
     Sonuç: ortam sesi, klavye, mouse sesi kesilir; konuşma temiz geçer. */
  useEffect(() => {
    if (!socket) return;

    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation:         true,
        noiseSuppression:         true,
        autoGainControl:          true,
        sampleRate:               48000,
        channelCount:             1,
        // Chrome-specific gelişmiş gürültü bastırma
        googEchoCancellation:     true,
        googNoiseSuppression:     true,
        googHighpassFilter:       true,
        googNoiseSuppression2:    true,
        googEchoCancellation2:    true,
        googDAEchoCancellation:   true,
        googAutoGainControl:      true,
        googTypingNoiseDetection: true,
      },
      video: false,
    })
    .then((raw) => {
      rawStreamRef.current = raw;

      const ctx = new (window.AudioContext||window.webkitAudioContext)({ sampleRate: 48000 });
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(raw);

      /* 1) Highpass: 100Hz altı ortam uğultusunu kes */
      const hi = ctx.createBiquadFilter();
      hi.type = "highpass"; hi.frequency.value = 100; hi.Q.value = 0.7;

      /* 2) Noise Gate — ScriptProcessor ile gerçek zamanlı RMS ölçümü
            Eşik altındaysa gain=0 (sessiz), üstündeyse gain=1 (temiz geçiş)
            Attack/release ile ani geçişler yumuşatılır */
      const GATE_THRESHOLD = 0.012; // RMS eşiği (0-1) — yükseltince daha agresif
      const ATTACK_TIME    = 0.003; // saniye — kapı açılma hızı
      const RELEASE_TIME   = 0.08;  // saniye — kapı kapanma hızı (çok hızlı = kelime kesimleri)

      const bufSize   = 2048;
      const processor = ctx.createScriptProcessor(bufSize, 1, 1);
      const gateGain  = ctx.createGain();
      gateGain.gain.value = 0;

      let currentGain = 0;
      const attackCoef  = 1 - Math.exp(-1 / (ctx.sampleRate * ATTACK_TIME));
      const releaseCoef = 1 - Math.exp(-1 / (ctx.sampleRate * RELEASE_TIME));

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        // RMS hesapla
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);

        const target = rms > GATE_THRESHOLD ? 1 : 0;
        const coef   = target > currentGain ? attackCoef : releaseCoef;
        currentGain += coef * (target - currentGain);
        gateGain.gain.setValueAtTime(Math.max(0, Math.min(1, currentGain)), ctx.currentTime);
      };

      /* Zincir: kaynak → highpass → processor(ölçüm) → gateGain → çıkış */
      const dest = ctx.createMediaStreamDestination();
      src.connect(hi);
      hi.connect(processor);
      processor.connect(ctx.destination); // processor bağlı olmalı (Chrome gereksinimi)
      hi.connect(gateGain);               // ses gateGain'den geçer
      gateGain.connect(dest);

      localStreamRef.current = dest.stream;
      setStatus("Bağlı ✓");
      socket.emit("voice:join", { channelId });
    })
    .catch(() => {
      setStatus("⚠ Mikrofon izni yok");
      socket.emit("voice:join", { channelId });
    });

    return () => {
      rawStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [socket, channelId]);

  /* Cleanup */
  useEffect(() => {
    return () => {
      Object.values(peersRef.current).forEach(pc => pc.close());
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close().catch(()=>{});
      socketRef.current?.emit("voice:leave", { channelId });
    };
  }, [channelId]);

  /* Peer */
  const createPC = useCallback((peerId) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId];
    const pc = new RTCPeerConnection(ICE_CONFIG);
    peersRef.current[peerId] = pc;

    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    screenStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, screenStreamRef.current));

    pc.ontrack = ({ track, streams }) => {
      let ms = remoteStreamsRef.current[peerId];
      if (!ms) { ms = streams[0] || new MediaStream(); remoteStreamsRef.current[peerId] = ms; }
      ms.getTracks().filter(t => t.kind===track.kind).forEach(t => ms.removeTrack(t));
      ms.addTrack(track);
      track.onended = refreshVideos;
      refreshVideos();
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socketRef.current?.emit("webrtc:ice-candidate", { to: peerId, candidate });
    };

    pc.oniceconnectionstatechange = async () => {
      if (pc.iceConnectionState === "failed") try { await pc.restartIce(); } catch {}
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

  /* Bitrate */
  const applyVideoQuality = useCallback(async (pc) => {
    const sender = pc.getSenders().find(s => s.track?.kind==="video");
    if (!sender) return;
    try {
      const p = sender.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      p.encodings.forEach(e => {
        e.maxBitrate   = 6_000_000;
        e.maxFramerate = 30;
        e.priority     = "high";
        e.networkPriority = "high";
        e.scaleResolutionDownBy = 1.0;
      });
      await sender.setParameters(p);
    } catch {}
  }, []);

  /* Socket olayları */
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
        await pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(()=>{});
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
      if (fullscreenPeer===peerId) setFullscreenPeer(null);
      playNotif("leave");
    });

    socket.on("voice:members-update", ({ members: m }) => setMembers(m));

    return () => {
      ["voice:existing-peers","voice:peer-joined","webrtc:offer","webrtc:answer",
       "webrtc:ice-candidate","voice:peer-left","voice:members-update"].forEach(e=>socket.off(e));
    };
  }, [socket, createPC, channelId, fullscreenPeer, refreshVideos, applyVideoQuality]);

  /* Ekran paylaşımı */
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width:          { ideal: 1920 },
          height:         { ideal: 1080 },
          frameRate:      { ideal: 30 },
          // cursor: "never" — mouse imleci yayında görünmez
          cursor:         "never",
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
          video: { width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30}, cursor:"never" },
          audio: true,
        })
      );

      // "motion" = oyun/video için — hareket sırasında blur yerine kalite koruma
      stream.getVideoTracks().forEach(t => { if ("contentHint" in t) t.contentHint = "motion"; });

      screenStreamRef.current = stream;
      setScreenStream(stream);
      setIsSharing(true);

      stream.getTracks().forEach(newTrack => {
        Object.values(peersRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind===newTrack.kind);
          if (sender) sender.replaceTrack(newTrack);
          else pc.addTrack(newTrack, stream);
        });
      });

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
    const s = screenStreamRef.current; if (!s) return;
    screenStreamRef.current = null;
    s.getTracks().forEach(t => t.stop());
    setScreenStream(null); setIsSharing(false);
    const mic = localStreamRef.current?.getAudioTracks()[0];
    Object.values(peersRef.current).forEach(pc => {
      pc.getSenders().forEach(s => {
        if (s.track?.kind==="video") s.replaceTrack(null).catch(()=>{});
        if (s.track?.kind==="audio" && mic) s.replaceTrack(mic).catch(()=>{});
      });
    });
    socket?.emit("voice:toggle-sharing", { channelId });
    if (fullscreenPeer==="local") setFullscreenPeer(null);
  };

  const toggleMute = () => {
    const mic = localStreamRef.current; if (!mic) return;
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
    audioCtxRef.current?.close().catch(()=>{});
    socket?.emit("voice:leave", { channelId });
    onLeave();
  };

  const hasVideo = isSharing ||
    remoteVideos.some(({stream}) => stream?.getVideoTracks().some(t => t.readyState==="live"));

  return (
    <>
      {/* Kişi sesi */}
      {remoteVideos.map(({peerId, stream}) => (
        <RemoteAudio key={`ra-${peerId}`} stream={stream} volume={voiceVolumes[peerId]??1} />
      ))}
      {/* Yayın sesi — sadece video olanlar */}
      {remoteVideos.map(({peerId, stream}) => {
        if (!stream?.getVideoTracks().some(t=>t.readyState==="live")) return null;
        return <StreamAudio key={`sa-${peerId}`} stream={stream} volume={streamVolumes[peerId]??1} />;
      })}

      {fullscreenPeer && (
        <FullscreenView
          peerId={fullscreenPeer}
          localScreenStream={screenStream}
          remoteStreams={remoteStreamsRef.current}
          members={members}
          streamVolumes={streamVolumes}
          onSetStreamVolume={(id,v) => setStreamVolumes(p=>({...p,[id]:v}))}
          onClose={() => setFullscreenPeer(null)}
        />
      )}

      <div className="voice-room">
        <div className="voice-header">
          <span className="voice-dot" />
          <span className="voice-title">{channelId}</span>
          <span className={`voice-status${status.includes("✓")?" v-ok":""}`}>{status}</span>
        </div>

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
            {remoteVideos.map(({peerId, stream}) => {
              const live = stream?.getVideoTracks().some(t=>t.readyState==="live");
              if (!live) return null;
              const mem = members.find(m=>m.socketId===peerId);
              const svol = streamVolumes[peerId]??1;
              return (
                <div key={peerId} className="voice-video-thumb"
                  onClick={() => setFullscreenPeer(peerId)}>
                  <VideoThumb stream={stream} muted />
                  <div className="thumb-overlay">
                    <span className="thumb-label">{mem?.username||"?"}</span>
                    <span className="thumb-fs">⛶</span>
                  </div>
                  {/* Yayın ses slider — kendi layer'ında, tıklama geçmez */}
                  <div className="thumb-vol-wrap"
                    onPointerDown={e => { e.stopPropagation(); e.preventDefault(); }}
                    onClick={e => { e.stopPropagation(); e.preventDefault(); }}>
                    <span className="thumb-vol-icon">📺</span>
                    <input type="range" min="0" max="1" step="0.05" value={svol}
                      className="thumb-vol-range"
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setStreamVolumes(p=>({...p,[peerId]:parseFloat(e.target.value)}))} />
                    <span className="thumb-vol-pct">{Math.round(svol*100)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="voice-members">
          <div className="voice-members-label">Kanalda ({members.length})</div>
          {members.map(m => {
            const isMe = m.username===user.username;
            const vvol = voiceVolumes[m.socketId]??1;
            return (
              <div key={m.socketId} className={`voice-member${m.sharing?" sharing":""}`}>
                <div className="voice-member-avatar" style={{background:avatarColor(m.username)}}>
                  {m.username.slice(0,2).toUpperCase()}
                </div>
                <div className="voice-member-info">
                  <div className="voice-member-top">
                    <span className="voice-member-name">{m.username}{isMe&&" (sen)"}</span>
                    <div className="voice-member-badges">
                      {m.muted   && <span className="voice-badge">🔇</span>}
                      {m.sharing && <span className="voice-badge">📡</span>}
                    </div>
                  </div>
                  {!isMe && (
                    <div className="voice-vol-row"
                      onPointerDown={e=>e.stopPropagation()}
                      onClick={e=>e.stopPropagation()}>
                      <span className="vol-icon">🎤</span>
                      <input type="range" min="0" max="1" step="0.05" value={vvol}
                        className="vol-slider"
                        onPointerDown={e=>e.stopPropagation()}
                        onChange={e=>setVoiceVolumes(p=>({...p,[m.socketId]:parseFloat(e.target.value)}))} />
                      <span className="vol-pct">{Math.round(vvol*100)}%</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="voice-controls">
          <button className={`voice-btn${isMuted?" v-danger":""}`} onClick={toggleMute}>
            <span>{isMuted?"🔇":"🎤"}</span>
            <span className="vbtn-label">{isMuted?"Sessiz":"Açık"}</span>
          </button>
          <button className={`voice-btn${isSharing?" v-active":""}`}
            onClick={isSharing ? stopScreenShare : startScreenShare}>
            <span>🖥</span>
            <span className="vbtn-label">{isSharing?"Durdur":"Paylaş"}</span>
          </button>
          <button className="voice-btn v-leave" onClick={leaveRoom}>
            <span>📴</span>
            <span className="vbtn-label">Ayrıl</span>
          </button>
        </div>
      </div>
    </>
  );
}
