import type { PeerConnection } from "./peer-connection.js";

/**
 * Waits for ICE gathering to fully complete, then returns the local
 * description as a single base64 blob containing the SDP *and* all
 * discovered candidates bundled in. This lets us skip a separate
 * candidate-exchange step for manual copy-paste signaling.
 *
 * Real signaling servers use "trickle ICE" (send candidates as they
 * arrive, don't wait) because it's faster — we're trading speed for
 * simplicity here since a human is doing the copy-pasting anyway.
 */
export function waitForIceGatheringComplete(peer: PeerConnection): Promise<void> {
  if (peer.raw.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    peer.raw.addEventListener("icegatheringstatechange", function handler() {
      if (peer.raw.iceGatheringState === "complete") {
        peer.raw.removeEventListener("icegatheringstatechange", handler);
        resolve();
      }
    });
  });
}

export function encodeSignal(description: RTCSessionDescriptionInit): string {
  return btoa(JSON.stringify(description));
}

export function decodeSignal(blob: string): RTCSessionDescriptionInit {
  return JSON.parse(atob(blob.trim()));
}
