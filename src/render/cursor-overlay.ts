import type { PresenceTracker, PresenceState } from "../network/presence.js";

const PEER_COLORS = ["#f74f8e", "#4ff78e", "#f7e14f", "#8e4ff7", "#4fd6f7"];

function colorForPeer(peerId: string): string {
  let hash = 0;
  for (let i = 0; i < peerId.length; i++) hash = (hash * 31 + peerId.charCodeAt(i)) | 0;
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
}

export function startCursorOverlay(presence: PresenceTracker): void {
  const cursorEls = new Map<string, HTMLDivElement>();

  function upsertCursor(state: PresenceState): void {
    if (!state.online || state.cursorX === undefined || state.cursorY === undefined) {
      removeCursor(state.peerId);
      return;
    }
    let el = cursorEls.get(state.peerId);
    if (!el) {
      el = document.createElement("div");
      el.style.position = "fixed";
      el.style.width = "12px";
      el.style.height = "12px";
      el.style.borderRadius = "50%";
      el.style.pointerEvents = "none";
      el.style.zIndex = "5";
      el.style.background = colorForPeer(state.peerId);
      el.style.transition = "left 0.05s linear, top 0.05s linear";
      document.body.appendChild(el);
      cursorEls.set(state.peerId, el);
    }
    el.style.left = `${state.cursorX - 6}px`;
    el.style.top = `${state.cursorY - 6}px`;
  }

  function removeCursor(peerId: string): void {
    const el = cursorEls.get(peerId);
    if (el) {
      el.remove();
      cursorEls.delete(peerId);
    }
  }

  presence.onPresenceChange(upsertCursor);
}
