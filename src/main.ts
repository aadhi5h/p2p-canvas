import { CanvasState } from "./canvas/state.js";
import { startPlaceholderRenderer } from "./render/placeholder-renderer.js";
import { hitTest } from "./canvas/hit-test.js";
import { PeerManager } from "./network/peer-manager.js";
import { CrdtProvider } from "./crdt/provider.js";
import { SyncedCanvas } from "./crdt/synced-canvas.js";
import { PresenceTracker } from "./network/presence.js";
import { startCursorOverlay } from "./render/cursor-overlay.js";

const canvasEl = document.getElementById("app-canvas") as HTMLCanvasElement;
const state = new CanvasState();
startPlaceholderRenderer(canvasEl, state);

const peerId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
const provider = new CrdtProvider(peerId);
const synced = new SyncedCanvas(provider, state);
const presence = new PresenceTracker(peerId);
startCursorOverlay(presence);

window.addEventListener("mousemove", (event) => {
  presence.broadcastCursor(event.clientX, event.clientY);
});

synced.addShape({ id: "r1", type: "rect", x: 100, y: 100, width: 120, height: 80, color: "#4f8ef7" , rotation: 0, zIndex: 0});
synced.addShape({ id: "r2", type: "rect", x: 260, y: 180, width: 80, height: 80, color: "#f77c4f" , rotation: 0, zIndex: 0});

let draggingId: string | undefined;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragMoved = false;

canvasEl.addEventListener("mousedown", (event) => {
  const hit = hitTest(state.getAllShapes(), event.clientX, event.clientY);
  if (hit) {
    draggingId = hit.id;
    dragOffsetX = event.clientX - hit.x;
    dragOffsetY = event.clientY - hit.y;
    dragMoved = false;
  }
});

canvasEl.addEventListener("mousemove", (event) => {
  if (!draggingId) return;
  dragMoved = true;
  synced.updateShape(draggingId, { x: event.clientX - dragOffsetX, y: event.clientY - dragOffsetY });
});

window.addEventListener("mouseup", () => {
  draggingId = undefined;
});

canvasEl.addEventListener("click", (event) => {
  // If that click was actually the END of a drag, don't also create a
  // new shape — dragMoved distinguishes "clicked to create" from
  // "released after dragging".
  if (dragMoved) {
    dragMoved = false;
    return;
  }
  const hit = hitTest(state.getAllShapes(), event.clientX, event.clientY);
  if (hit) return; // clicked an existing shape without dragging — do nothing, don't stack a new one on top

  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const colors = ["#4f8ef7", "#f77c4f", "#4ff78e", "#f74f8e", "#f7e14f"];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const zIndex = state.getAllShapes().length;

  if (Math.random() < 0.5) {
    synced.addShape({
      id, type: "rect",
      x: event.clientX - 25, y: event.clientY - 25, width: 50, height: 50,
      color, rotation: Math.random() * 45, zIndex,
    });
  } else {
    synced.addShape({
      id, type: "circle",
      x: event.clientX, y: event.clientY, radius: 25,
      color, rotation: 0, zIndex,
    });
  }
});

const manager = new PeerManager();
const peerStatuses = new Map<string, RTCPeerConnectionState>();
const peerListEl = document.getElementById("peer-list")!;
const actionStatus = document.getElementById("action-status")!;
const offlineIndicator = document.getElementById("offline-indicator")!;
updateOfflineIndicator();
const offerOut = document.getElementById("offer-out") as HTMLTextAreaElement;
const offerIn = document.getElementById("offer-in") as HTMLTextAreaElement;
const answerOut = document.getElementById("answer-out") as HTMLTextAreaElement;
const answerIn = document.getElementById("answer-in") as HTMLTextAreaElement;

let lastOfferedPeerId: string | undefined;


function connectedPeerCount(): number {
  return Array.from(peerStatuses.values()).filter((s) => s === "connected").length;
}

function updateOfflineIndicator(): void {
  const count = connectedPeerCount();
  if (count === 0) {
    offlineIndicator.textContent = "OFFLINE — editing locally, will sync when connected";
    offlineIndicator.style.background = "#5a2a2a";
    offlineIndicator.style.color = "#f7a5a5";
  } else {
    offlineIndicator.textContent = `ONLINE — synced with ${count} peer${count === 1 ? "" : "s"}`;
    offlineIndicator.style.background = "#2a5a2a";
    offlineIndicator.style.color = "#a5f7a5";
  }
}

function renderPeerList() {
  peerListEl.innerHTML = Array.from(peerStatuses.entries())
    .map(([id, status]) => `<div>${id.slice(0, 8)}: <b>${status}</b></div>`)
    .join("");
}

manager.onStatusChange((peerId, status) => {
  peerStatuses.set(peerId, status);
  renderPeerList();
  updateOfflineIndicator();
});

manager.onTransportReady((_peerId, transport) => {
  synced.attachTransport(transport);
  presence.attachTransport(transport);
});

manager.onDisconnect((peerId, transport) => {
  if (transport) provider.detachTransport(transport);
  if (transport) presence.detachTransport(transport);
  peerStatuses.delete(peerId);
  renderPeerList();
  updateOfflineIndicator();
});

function safeHandler(fn: () => Promise<void>) {
  return () => fn().catch((err) => console.error("[handler error]", err));
}

document.getElementById("btn-create-offer")!.addEventListener("click", safeHandler(async () => {
  actionStatus.textContent = "gathering ICE candidates...";
  const { peerId, offerBlob } = await manager.createOffer();
  lastOfferedPeerId = peerId;
  offerOut.value = offerBlob;
  actionStatus.textContent = "offer ready — send it to the other tab";
}));

document.getElementById("btn-join")!.addEventListener("click", safeHandler(async () => {
  actionStatus.textContent = "gathering ICE candidates...";
  const { answerBlob } = await manager.acceptOffer(offerIn.value);
  answerOut.value = answerBlob;
  actionStatus.textContent = "answer ready — send it back";
}));

document.getElementById("btn-complete")!.addEventListener("click", safeHandler(async () => {
  if (!lastOfferedPeerId) throw new Error("No pending offer to complete — click 'Add Peer: Create Offer' first");
  actionStatus.textContent = "completing connection...";
  await manager.acceptAnswer(lastOfferedPeerId, answerIn.value);
  actionStatus.textContent = "";
}));

(window as any).debug = {
  manager, state, provider, synced,
  shapeCount: () => provider.getAllShapes().length,
  shapeIds: () => provider.getAllShapes().map((s) => s.id).sort(),
  presence,
  onlinePeers: () => presence.getOnlinePeers(),
  isOffline: () => connectedPeerCount() === 0,
};

// Day 33 experiment: deliberately provoke the whole-value LWW gap
// from Day 18. Click "Set color" in Tab 1 and "Move position" in
// Tab 2 within about a second of each other — one edit will fully
// overwrite the other rather than merging, which is the documented
// (if unintuitive) current behavior. Day 37 addresses this properly.
document.getElementById("btn-experiment-color")?.addEventListener("click", () => {
  const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff"];
  synced.updateShape("r1", { color: colors[Math.floor(Math.random() * colors.length)] });
  console.log("[experiment] set r1 color, shape now:", provider.getShape("r1"));
});

document.getElementById("btn-experiment-move")?.addEventListener("click", () => {
  const x = Math.floor(Math.random() * 400);
  const y = Math.floor(Math.random() * 400);
  synced.updateShape("r1", { x, y });
  console.log("[experiment] moved r1, shape now:", provider.getShape("r1"));
});


// TRUE concurrent edit: built from a FIXED base shape, not whatever
// is currently live — so clicking both in either order/timing still
// produces a genuine collision, unlike the merge-with-current
// buttons above which can accidentally sequence themselves.
const collisionBase = { id: "r1", type: "rect" as const, x: 100, y: 100, width: 120, height: 80, color: "#4f8ef7", rotation: 0, zIndex: 0 };

document.getElementById("btn-force-collision-color")?.addEventListener("click", () => {
  synced.addShape({ ...collisionBase, color: "#ff0000" }); // addShape = raw set, no merge with current
  console.log("[force-collision] sent COLOR-only edit built from fixed base");
});

document.getElementById("btn-force-collision-move")?.addEventListener("click", () => {
  synced.addShape({ ...collisionBase, x: 999, y: 999 });
  console.log("[force-collision] sent POSITION-only edit built from fixed base");
});


