import type { PresenceTracker, PresenceState } from "../network/presence.js";
import type { Viewport } from "../canvas/viewport.js";

const PEER_COLORS = ["#f74f8e", "#4ff78e", "#f7e14f", "#8e4ff7", "#4fd6f7"];
function colorForPeer(peerId: string): string {
  let hash = 0;
  for (let i = 0; i < peerId.length; i++) hash = (hash * 31 + peerId.charCodeAt(i)) | 0;
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
}

export function startCursorOverlay(presence: PresenceTracker, viewport: Viewport): void {
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
      document.body.appendChild(el);
      cursorEls.set(state.peerId, el);
    }
    const screen = viewport.worldToScreen(state.cursorX, state.cursorY);
    el.style.left = `${screen.x - 6}px`;
    el.style.top = `${screen.y - 6}px`;
  }

  function removeCursor(peerId: string): void {
    const el = cursorEls.get(peerId);
    if (el) { el.remove(); cursorEls.delete(peerId); }
  }

  presence.onPresenceChange(upsertCursor);
  // Reposition existing cursors when OUR OWN viewport changes,
  // otherwise they'd stay glued to stale screen coordinates.
  viewport.onChange(() => {
    for (const state of presence.getOnlinePeers()) upsertCursor(state);
  });
}
