import { useRef, useState, useCallback } from "react";

// Ücretsiz public STUN sunucuları (Google, Cloudflare)
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    // Opsiyonel: kendi TURN sunucunuzu ekleyebilirsiniz
    // { urls: "turn:YOUR_TURN_SERVER", username: "user", credential: "pass" }
  ],
};

export function useWebRTC({ socket, channelId, localStream }) {
  const peers = useRef({}); // peerId -> RTCPeerConnection
  const [remoteStreams, setRemoteStreams] = useState({}); // peerId -> MediaStream

  const addRemoteStream = useCallback((peerId, stream) => {
    setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
  }, []);

  const removeRemoteStream = useCallback((peerId) => {
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  // Yeni bir peer bağlantısı oluştur
  const createPeerConnection = useCallback(
    (peerId) => {
      if (peers.current[peerId]) return peers.current[peerId];

      const pc = new RTCPeerConnection(ICE_SERVERS);
      peers.current[peerId] = pc;

      // Lokal stream'i ekle
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });
      }

      // Uzak stream gelince kaydet
      pc.ontrack = (event) => {
        addRemoteStream(peerId, event.streams[0]);
      };

      // ICE candidate gelince socket üzerinden ilet
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit("webrtc:ice-candidate", {
            to: peerId,
            candidate: event.candidate,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed"
        ) {
          removeRemoteStream(peerId);
          delete peers.current[peerId];
        }
      };

      return pc;
    },
    [localStream, socket, addRemoteStream, removeRemoteStream]
  );

  // Offer gönder (mevcut üyelere)
  const callPeer = useCallback(
    async (peerId) => {
      const pc = createPeerConnection(peerId);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      socket?.emit("webrtc:offer", { to: peerId, offer, channelId });
    },
    [createPeerConnection, socket, channelId]
  );

  // Gelen offer'a cevap ver
  const handleOffer = useCallback(
    async ({ from, offer }) => {
      const pc = createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket?.emit("webrtc:answer", { to: from, answer });
    },
    [createPeerConnection, socket]
  );

  // Gelen answer'ı işle
  const handleAnswer = useCallback(async ({ from, answer }) => {
    const pc = peers.current[from];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }, []);

  // ICE candidate ekle
  const handleIceCandidate = useCallback(async ({ from, candidate }) => {
    const pc = peers.current[from];
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    }
  }, []);

  // Peer bağlantısını kapat
  const closePeer = useCallback(
    (peerId) => {
      peers.current[peerId]?.close();
      delete peers.current[peerId];
      removeRemoteStream(peerId);
    },
    [removeRemoteStream]
  );

  // Tüm bağlantıları kapat
  const closeAll = useCallback(() => {
    Object.keys(peers.current).forEach(closePeer);
  }, [closePeer]);

  // Stream değişince (ekran paylaşımı vb.) tüm peer'lara yeni track gönder
  const replaceTrack = useCallback((newStream) => {
    Object.values(peers.current).forEach((pc) => {
      newStream.getTracks().forEach((newTrack) => {
        const sender = pc
          .getSenders()
          .find((s) => s.track?.kind === newTrack.kind);
        if (sender) sender.replaceTrack(newTrack);
      });
    });
  }, []);

  return {
    remoteStreams,
    callPeer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    closePeer,
    closeAll,
    replaceTrack,
  };
}
