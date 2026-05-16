import { useState, useEffect, useRef, useCallback } from "react";
import "./VoiceRoom.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";

// Sadece STUN — TURN sunucu /api/ice-servers'dan dinamik alınır
const STUN_ONLY = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
};

/* ── Ses elementi (her remote peer için, thumbnail muted) ─── */
function RemoteAudio({ stream, volume }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !stream) return;
    ref.current.srcObject = stream;
    ref.current.volume = volume ?? 1;
    ref.current.play().catch(() => {});
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.volume = volume ?? 1;
  }, [volume]);
  return <audio ref={ref} autoPlay playsInline style={{ display:"none" }} />;
}

/* ── Küçük video thumbnail (muted — ses RemoteAudio'dan gelir) ── */
function VideoThumb({ stream, muted }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) { ref.current.srcObject = stream; ref.current.play().catch(() => {}); }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={!!muted} className="thumb-video" />;
}

/* ── Tam ekran görünümü — masaüstünde OS API, mobilde CSS overlay ── */
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

  /* Mobil tespiti — iOS/Android'de requestFullscreen çalışmaz/stream kopar */
  const isMobile = useRef(
    typeof window !== "undefined" &&
    ("ontouchstart" in window || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent))
  ).current;

  /* Stream'i video elementine bağla — orientation change sonrası da çağrılır */
  const attachStream = useCallback(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    if (!isLocal && audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      audioRef.current.volume = vol;
      audioRef.current.play().catch(() => {});
    }
  }, [stream, isLocal, vol]);

  useEffect(() => { attachStream(); }, [attachStream]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = vol; }, [vol]);

  /* OS fullscreen — sadece masaüstünde; mobilde CSS overlay yeterli */
  useEffect(() => {
    if (isMobile) return;
    const el = wrapRef.current;
    if (!el) return;
    const req = el.requestFullscreen?.bind(el)
      || el.webkitRequestFullscreen?.bind(el)
      || el.mozRequestFullScreen?.bind(el);
    req?.().catch(() => {});
    const onChange = () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) onClose();
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      const exit = document.exitFullscreen?.bind(document) || document.webkitExitFullscreen?.bind(document);
      if (document.fullscreenElement || document.webkitFullscreenElement) exit?.().catch(() => {});
    };
  }, [onClose, isMobile]);

  /* Mobil: yatay/dikey geçişte stream yeniden bağla.
     Strateji:
     - orientationchange: layout HENÜZ güncel değil → sadece resize'ı bekle
     - resize: layout tamamlandı → requestAnimationFrame ile bir sonraki
       çizim döngüsünde (~16ms, 60fps) srcObject'i sıfırlayıp yeniden bağla.
       Böylece iOS video render motoru uyanır, siyah ekran olmaz.
  */
  useEffect(() => {
    if (!isMobile) return;
    let rafId = null;

    const reattach = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const vid = videoRef.current;
        if (vid && stream) {
          vid.srcObject = null;          // iOS'u yeniden başlatmaya zorla
          vid.srcObject = stream;
          vid.play().catch(() => {});
        }
      });
    };

    /* resize, orientationchange'den farklı olarak layout güncel olunca gelir */
    window.addEventListener("resize", reattach);
    /* orientationchange'i de tut — resize gelmezse fallback olsun */
    window.addEventListener("orientationchange", reattach);
    screen.orientation?.addEventListener?.("change", reattach);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", reattach);
      window.removeEventListener("orientationchange", reattach);
      screen.orientation?.removeEventListener?.("change", reattach);
    };
  }, [isMobile, stream]);

  /* Bar otomatik gizle (mobilde 5 sn, masaüstünde 3 sn) */
  const bumpBar = useCallback(() => {
    setBarVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setBarVisible(false), isMobile ? 5000 : 3000);
  }, [isMobile]);
  useEffect(() => { bumpBar(); return () => clearTimeout(timerRef.current); }, [bumpBar]);

  return (
    <div ref={wrapRef} className={`fs-wrap${isMobile ? " fs-mobile" : ""}`}
      onMouseMove={bumpBar} onTouchStart={bumpBar}>
      <video ref={videoRef} autoPlay playsInline muted={isLocal} className="fs-video" />
      {!isLocal && <audio ref={audioRef} autoPlay playsInline style={{ display:"none" }} />}
      <div className={`fs-bar${barVisible ? " fs-bar-show" : ""}${isMobile ? " fs-bar-mobile" : ""}`}
        onClick={(e) => e.stopPropagation()}>
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
  const [localStream,    setLocalStream]    = useState(null);
  const [screenStream,   setScreenStream]   = useState(null);
  const [isSharing,      setIsSharing]      = useState(false);
  const [isMuted,        setIsMuted]        = useState(false);
  const [members,        setMembers]        = useState([]);
  const [status,         setStatus]         = useState("Mikrofon bekleniyor...");
  const [fullscreenPeer, setFullscreenPeer] = useState(null);
  const [volumes,        setVolumes]        = useState({});
  const [remoteVideos,   setRemoteVideos]   = useState([]);

  const peersRef         = useRef({});
  const remoteStreamsRef = useRef({});
  const localStreamRef   = useRef(null);
  const screenStreamRef  = useRef(null);
  const iceServersRef    = useRef(STUN_ONLY); // sunucudan gelene kadar STUN kullan

  /* ICE / TURN sunucu bilgilerini sunucudan al — credential'lar client'ta olmamalı */
  useEffect(() => {
    fetch(`${SERVER_URL}/api/ice-servers`)
      .then((r) => r.json())
      .then(({ iceServers }) => {
        if (Array.isArray(iceServers) && iceServers.length > 0) {
          iceServersRef.current = { iceServers };
          const hasTurn = iceServers.some((s) =>
            [s.urls].flat().some((u) => u.startsWith("turn:") || u.startsWith("turns:"))
          );
          if (!hasTurn) {
            console.warn("[ICE] TURN sunucu yok — farklı ağlarda (mobil veri) bağlantı kurulamayabilir.");
          }
        }
      })
      .catch(() => {
        console.warn("[ICE] Sunucudan ICE listesi alınamadı, STUN ile devam ediliyor.");
      });
  }, []); // eslint-disable-line

  const refreshVideos = useCallback(() =>
    setRemoteVideos(Object.entries(remoteStreamsRef.current).map(([id, s]) => ({ peerId: id, stream: s }))), []);

  /* 1. Mikrofon — gürültü bastırma maksimum, ortam sesi minimum */
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation:    true,
        noiseSuppression:    true,
        autoGainControl:     false,  // AGC ortam sesini yükseltir, kapalı daha iyi
        sampleRate:          48000,
        channelCount:        1,      // mono: gürültü bastırma algoritmaları mono'da çok daha etkili
        // Chrome / Edge genişletilmiş kısıtlamaları
        googEchoCancellation:      true,
        googNoiseSuppression:      true,
        googHighpassFilter:        true,  // düşük frekanslı ortam sesini (uğultu, klima) keser
        googNoiseSuppression2:     true,
        googEchoCancellation2:     true,
        googAutoGainControl:       false,
        googTypingNoiseDetection:  true,
      },
      video: false,
    })
    .then((stream) => {
      setLocalStream(stream);
      localStreamRef.current = stream;
      setStatus("Bağlı ✓");
      socket?.emit("voice:join", { channelId });
    })
    .catch((err) => {
      console.warn("Mikrofon izni yok:", err.message);
      setStatus("⚠ Mikrofon izni yok");
      socket?.emit("voice:join", { channelId });
    });
    return () => {};
  }, []); // eslint-disable-line

  /* cleanup */
  useEffect(() => () => {
    Object.values(peersRef.current).forEach((pc) => pc.close());
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  /* 2. Peer bağlantısı */
  const createPC = useCallback((peerId) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId];

    const pc = new RTCPeerConnection({
      ...iceServersRef.current,      // sunucudan alınan gerçek TURN credential'ları
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });
    peersRef.current[peerId] = pc;

    /* mikrofon track'i ekle */
    const mic = localStreamRef.current;
    if (mic) {
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));
    } else {
      /* mikrofon yoksa en azından ses alalım */
      pc.addTransceiver("audio", { direction: "recvonly" });
    }

    /* Zaten ekran paylaşılıyorsa yeni peer'a da ekle (geç katılanlar görsün) */
    const scr = screenStreamRef.current;
    if (scr) {
      scr.getTracks().forEach((t) => pc.addTrack(t, scr));
    }

    /* gelen track (audio veya video ayrı ayrı gelir) */
    pc.ontrack = ({ track, streams }) => {
      let ms = remoteStreamsRef.current[peerId];
      if (!ms) { ms = streams[0] || new MediaStream(); remoteStreamsRef.current[peerId] = ms; }
      /* aynı türde eski track varsa çıkar */
      ms.getTracks().filter((t) => t.kind === track.kind).forEach((t) => { ms.removeTrack(t); });
      ms.addTrack(track);
      track.onended = refreshVideos;
      refreshVideos();
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket?.emit("webrtc:ice-candidate", { to: peerId, candidate });
    };

    
    pc.oniceconnectionstatechange = async () => {
      if (pc.iceConnectionState === "failed") {
        try {
          await pc.restartIce();
        } catch (e) {
          console.warn("ICE restart failed", e);
        }
      }
    };
pc.onconnectionstatechange = () => {
      if (["disconnected","failed","closed"].includes(pc.connectionState)) {
        delete peersRef.current[peerId];
        delete remoteStreamsRef.current[peerId];
        refreshVideos();
      }
    };

    return pc;
  }, [socket, refreshVideos]);

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
      if (pc && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(() => {});
        /* Bağlantı kuruldu — ekran paylaşımı aktifse yüksek kalite bitrate uygula */
        if (screenStreamRef.current) {
          const vs = pc.getSenders().find((s) => s.track?.kind === "video");
          if (vs) applyHighQuality(vs);
        }
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

  /* Ekran paylaşımı video sender'ına yüksek kalite parametresi uygula */
  const applyHighQuality = useCallback(async (sender) => {
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings.forEach((enc) => {
        enc.maxBitrate      = 4_000_000; // 4 Mbps — 1080p için minimum
        enc.maxFramerate    = 30;
        enc.networkPriority = "high";
        enc.priority        = "high";
      });
      await sender.setParameters(params);
    } catch { /* bazı tarayıcılar setParameters'ı desteklemez, sessizce geç */ }
  }, []);

  /* 4. Ekran paylaşımı — 1080p, yüksek kalite, düşük gecikme */
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width:          { min: 1280, ideal: 1920, max: 1920 },
          height:         { min: 720,  ideal: 1080, max: 1080 },
          frameRate:      { ideal: 30, max: 30 },  // 30fps = kareye daha fazla bit → daha keskin görüntü
          cursor:         "always",
          latencyHint:    "interactive",
          displaySurface: "monitor",  // ekranın tamamını tercih et (pencere/sekme değil)
        },
        audio: {
          echoCancellation:  false,  // sistem sesi için echo cancellation gerekmez
          noiseSuppression:  false,
          autoGainControl:   false,
          sampleRate:        48000,
          suppressLocalAudioPlayback: true,  // hoparlörden gelen sesi tekrar yakalamayı engeller
        },
        selfBrowserSurface: "include",
        preferCurrentTab:   false,
        systemAudio:        "include",
      });

      /* contentHint: "detail" — tarayıcıya "bu ekran içeriği, keskinlik öncelikli" de
         (motion: akıcılık öncelikli, detail/text: kalite öncelikli) */
      stream.getVideoTracks().forEach((t) => {
        if ("contentHint" in t) t.contentHint = "detail";
      });

      setScreenStream(stream);
      screenStreamRef.current = stream;
      setIsSharing(true);

      /* tüm track türlerini (video + sistem sesi) peer'lara gönder */
      stream.getTracks().forEach((newTrack) => {
        Object.values(peersRef.current).forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === newTrack.kind);
          if (sender) sender.replaceTrack(newTrack);
          else        pc.addTrack(newTrack, stream);
        });
      });

      /* Renegotiation + yüksek kalite bitrate ayarla */
      await Promise.all(
        Object.entries(peersRef.current).map(async ([peerId, pc]) => {
          try {
            if (pc.signalingState !== "stable") return;
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket?.emit("webrtc:offer", { to: peerId, offer, channelId });

            /* Bitrate'i offer gönderildikten hemen sonra ayarla.
               Answer gelince webrtc:answer handler'ı da tekrar uygular. */
            const vs = pc.getSenders().find((s) => s.track?.kind === "video");
            if (vs) applyHighQuality(vs);
          } catch (err) {
            console.error("Ekran paylaşımı renegotiation hatası:", peerId, err);
          }
        })
      );

      socket?.emit("voice:toggle-sharing", { channelId });
      stream.getVideoTracks()[0].onended = () => stopScreenShare();
    } catch (err) {
      if (err.name !== "NotAllowedError") console.error("Ekran paylaşımı hatası:", err);
    }
  };

  const stopScreenShare = () => {
    screenStream?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    setIsSharing(false);
    /* mic'i geri yükle */
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

  const setVolume   = (peerId, value) => setVolumes((p) => ({ ...p, [peerId]: value }));
  const leaveRoom   = () => {
    Object.values(peersRef.current).forEach((pc) => pc.close());
    peersRef.current = {};
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStream?.getTracks().forEach((t) => t.stop());
    socket?.emit("voice:leave", { channelId });
    onLeave();
  };

  const hasAnyVideo = isSharing ||
    remoteVideos.some(({ stream }) => stream?.getVideoTracks().some((t) => t.readyState === "live"));

  return (
    <>
      {/* Gizli ses elementleri — thumbnail muted, ses buradan */}
      {remoteVideos.map(({ peerId, stream }) => (
        <RemoteAudio key={peerId} stream={stream} volume={volumes[peerId] ?? 1} />
      ))}

      {/* OS tam ekran */}
      {fullscreenPeer && (
        <FullscreenView
          peerId={fullscreenPeer}
          localScreenStream={screenStream}
          remoteStreams={remoteStreamsRef.current}
          members={members}
          volumes={volumes}
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

        {/* Video önizlemeler */}
        {hasAnyVideo && (
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

        {/* Üyeler + ses slider */}
        <div className="voice-members">
          <div className="voice-members-label">Kanalda ({members.length})</div>
          {members.map((m) => {
            const isMe = m.username === user.username;
            const vol  = volumes[m.socketId] ?? 1;
            return (
              <div key={m.socketId} className={`voice-member ${m.sharing ? "sharing" : ""}`}>
                <div className="voice-member-dot" style={{ background: m.muted ? "#555870" : "var(--green)" }} />
                <span className="voice-member-name">{m.username}{isMe && " (sen)"}</span>
                {m.muted && <span className="voice-badge">🔇</span>}
                {m.sharing && <span className="voice-badge">📡</span>}
                {!isMe && (
                  <input type="range" min="0" max="1" step="0.05" value={vol}
                    className="vol-slider" title={`${Math.round(vol * 100)}%`}
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
          <button className={`voice-btn ${isSharing ? "v-active" : ""}`}
            onClick={isSharing ? stopScreenShare : startScreenShare}>
            {isSharing ? "⏹ Dur" : "🖥 Paylaş"}
          </button>
          <button className="voice-btn v-leave" onClick={leaveRoom}>📴 Ayrıl</button>
        </div>
      </div>
    </>
  );
}
