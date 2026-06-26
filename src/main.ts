import { CanvasState } from "./canvas/state.js";
import { startPlaceholderRenderer } from "./render/placeholder-renderer.js";
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

synced.addShape({ id: "r1", type: "rect", x: 100, y: 100, width: 120, height: 80, color: "#4f8ef7" });
synced.addShape({ id: "r2", type: "rect", x: 260, y: 180, width: 80, height: 80, color: "#f77c4f" });

canvasEl.addEventListener("click", (event) => {
  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const colors = ["#4f8ef7", "#f77c4f", "#4ff78e", "#f74f8e", "#f7e14f"];
  synced.addShape({
    id, type: "rect",
    x: event.clientX - 25, y: event.clientY - 25, width: 50, height: 50,
    color: colors[Math.floor(Math.random() * colors.length)],
  });
});

const manager = new PeerManager();
const peerStatuses = new Map<string, RTCPeerConnectionState>();
const peerListEl = document.getElementById("peer-list")!;
const actionStatus = document.getElementById("action-status")!;
const offerOut = document.getElementById("offer-out") as HTMLTextAreaElement;
const offerIn = document.getElementById("offer-in") as HTMLTextAreaElement;
const answerOut = document.getElementById("answer-out") as HTMLTextAreaElement;
const answerIn = document.getElementById("answer-in") as HTMLTextAreaElement;

let lastOfferedPeerId: string | undefined;

function renderPeerList() {
  peerListEl.innerHTML = Array.from(peerStatuses.entries())
    .map(([id, status]) => `<div>${id.slice(0, 8)}: <b>${status}</b></div>`)
    .join("");
}

manager.onStatusChange((peerId, status) => {
  peerStatuses.set(peerId, status);
  renderPeerList();
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
};
