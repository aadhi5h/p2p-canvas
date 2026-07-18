import type { PresenceTracker, PresenceState } from "../network/presence.js";
import type { Viewport } from "../canvas/viewport.js";

const PEER_COLORS = ["#f74f8e", "#4ff78e", "#f7e14f", "#8e4ff7", "#4fd6f7"];
function colorForPeer(peerId: string): string {
  let hash = 0;
  for (let i = 0; i < peerId.length; i++) hash = (hash * 31 + peerId.charCodeAt(i)) | 0;
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
}

/**
 * Draws a dashed rectangle for each other connected peer, showing
 * roughly what part of the canvas they're currently looking at.
 * NOTE: this assumes each peer's browser window is the same size as
 * yours (we have no way to know their actual dimensions without
 * sending them) — an approximation, not exact.
 */
export function startViewportOverlay(presence: PresenceTracker, viewport: Viewport): void {
  const boxEls = new Map<string, HTMLDivElement>();

  function upsertBox(state: PresenceState): void {
    if (!state.online || state.vpX === undefined || state.vpY === undefined || state.vpZoom === undefined) {
      removeBox(state.peerId);
      return;
    }
    let el = boxEls.get(state.peerId);
    if (!el) {
      el = document.createElement("div");
      el.style.position = "fixed";
      el.style.border = `2px dashed ${colorForPeer(state.peerId)}`;
      el.style.pointerEvents = "none";
      el.style.zIndex = "4";
      document.body.appendChild(el);
      boxEls.set(state.peerId, el);
    }
    const worldWidth = window.innerWidth / state.vpZoom;
    const worldHeight = window.innerHeight / state.vpZoom;
    const topLeft = viewport.worldToScreen(state.vpX, state.vpY);
    const bottomRight = viewport.worldToScreen(state.vpX + worldWidth, state.vpY + worldHeight);
    el.style.left = `${topLeft.x}px`;
    el.style.top = `${topLeft.y}px`;
    el.style.width = `${Math.max(0, bottomRight.x - topLeft.x)}px`;
    el.style.height = `${Math.max(0, bottomRight.y - topLeft.y)}px`;
  }

  function removeBox(peerId: string): void {
    const el = boxEls.get(peerId);
    if (el) { el.remove(); boxEls.delete(peerId); }
  }

  presence.onPresenceChange(upsertBox);
  viewport.onChange(() => {
    for (const state of presence.getOnlinePeers()) upsertBox(state);
  });
}
