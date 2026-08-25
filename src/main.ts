import { CanvasState } from "./canvas/state.js";
import { startPlaceholderRenderer } from "./render/placeholder-renderer.js";
import { hitTest } from "./canvas/hit-test.js";
import { Viewport } from "./canvas/viewport.js";
import { PeerManager } from "./network/peer-manager.js";
import { CrdtProvider } from "./crdt/provider.js";
import { SyncedCanvas } from "./crdt/synced-canvas.js";
import { PresenceTracker } from "./network/presence.js";
import { startCursorOverlay } from "./render/cursor-overlay.js";
import { startViewportOverlay } from "./render/viewport-overlay.js";

const canvasEl = document.getElementById("app-canvas") as HTMLCanvasElement;
const state = new CanvasState();
const viewport = new Viewport();
startPlaceholderRenderer(canvasEl, state, viewport);

// Day 53: WebGPU device/context initialization, running alongside
// the existing Canvas2D renderer (not replacing it yet — that's
// Day 58+). Proves the GPU pipeline works before shapes get added.
import("./render/webgpu/device.js").then(async ({ initWebGPU }) => {
  const webgpuCanvas = document.getElementById("webgpu-canvas") as HTMLCanvasElement | null;
  const statusEl = document.getElementById("webgpu-status")!;
  if (!webgpuCanvas) return;

  const gpu = await initWebGPU(webgpuCanvas);
  if (!gpu) {
    statusEl.textContent = "WebGPU: unavailable in this browser";
    statusEl.style.color = "#f7a5a5";
    return;
  }

  statusEl.textContent = "WebGPU: device + context initialized ✓";
  statusEl.style.color = "#a5f7a5";

  const { startWebGPURenderer } = await import("./render/webgpu/webgpu-renderer.js");
  startWebGPURenderer(webgpuCanvas, gpu, provider, viewport);

  const { createPickPipeline, gpuHitTest } = await import("./render/webgpu/pick-pipeline.js");
  const pick = createPickPipeline(gpu.device);
  const { runRenderBenchmark } = await import("./render/webgpu/benchmark.js");

  (window as any).debug = {
    ...(window as any).debug,
    gpuHitTest: (x: number, y: number) =>
      gpuHitTest(gpu.device, pick, provider.getAllShapes(), viewport.get(), webgpuCanvas.width, webgpuCanvas.height, x, y),
    runBenchmark: (count: number) => runRenderBenchmark(state, count),
  };
});


const peerId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
const provider = new CrdtProvider(peerId);
const synced = new SyncedCanvas(provider, state);
const presence = new PresenceTracker(peerId);
startCursorOverlay(presence, viewport);
startViewportOverlay(presence, viewport);

viewport.onChange(() => presence.broadcastViewport(viewport.get()));

window.addEventListener("mousemove", (event) => {
  const world = viewport.screenToWorld(event.clientX, event.clientY);
  presence.broadcastCursor(world.x, world.y);
});

synced.addShape({ id: "r1", type: "rect", x: 100, y: 100, width: 120, height: 80, color: "#4f8ef7", rotation: 0, zIndex: 0 });
synced.addShape({ id: "r2", type: "rect", x: 260, y: 180, width: 80, height: 80, color: "#f77c4f", rotation: 0, zIndex: 0 });

let draggingId: string | undefined;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragMoved = false;
let isPanning = false;
let lastPanScreenX = 0;
let lastPanScreenY = 0;

canvasEl.addEventListener("mousedown", (event) => {
  const world = viewport.screenToWorld(event.clientX, event.clientY);
  const hit = hitTest(state.getAllShapes(), world.x, world.y);
  if (hit) {
    draggingId = hit.id;
    dragOffsetX = world.x - hit.x;
    dragOffsetY = world.y - hit.y;
    dragMoved = false;
  } else {
    isPanning = true;
    lastPanScreenX = event.clientX;
    lastPanScreenY = event.clientY;
  }
});

canvasEl.addEventListener("mousemove", (event) => {
  if (draggingId) {
    dragMoved = true;
    const world = viewport.screenToWorld(event.clientX, event.clientY);
    synced.updateShape(draggingId, { x: world.x - dragOffsetX, y: world.y - dragOffsetY });
  } else if (isPanning) {
    const dx = event.clientX - lastPanScreenX;
    const dy = event.clientY - lastPanScreenY;
    viewport.pan(dx, dy);
    lastPanScreenX = event.clientX;
    lastPanScreenY = event.clientY;
  }
});

window.addEventListener("mouseup", () => {
  draggingId = undefined;
  isPanning = false;
});

canvasEl.addEventListener("wheel", (event) => {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.1 : 0.9;
  viewport.zoomAt(factor, event.clientX, event.clientY);
}, { passive: false });

canvasEl.addEventListener("click", (event) => {
  if (dragMoved) {
    dragMoved = false;
    return;
  }
  if (isPanning) return; // click that ends a pan shouldn't also create a shape
  const world = viewport.screenToWorld(event.clientX, event.clientY);
  const hit = hitTest(state.getAllShapes(), world.x, world.y);
  if (hit) return;

  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const colors = ["#4f8ef7", "#f77c4f", "#4ff78e", "#f74f8e", "#f7e14f"];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const zIndex = state.getAllShapes().length;

  if (Math.random() < 0.5) {
    synced.addShape({
      id, type: "rect",
      x: world.x - 25, y: world.y - 25, width: 50, height: 50,
      color, rotation: Math.random() * 45, zIndex,
    });
  } else {
    synced.addShape({
      id, type: "circle",
      x: world.x, y: world.y, radius: 25,
      color, rotation: 0, zIndex,
    });
  }
});

const manager = new PeerManager();
const peerStatuses = new Map<string, RTCPeerConnectionState>();
const peerListEl = document.getElementById("peer-list")!;
const actionStatus = document.getElementById("action-status")!;
const offlineIndicator = document.getElementById("offline-indicator")!;
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

updateOfflineIndicator();

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
  manager, state, provider, synced, viewport,
  shapeCount: () => provider.getAllShapes().length,
  shapeIds: () => provider.getAllShapes().map((s) => s.id).sort(),
  presence,
  onlinePeers: () => presence.getOnlinePeers(),
  isOffline: () => connectedPeerCount() === 0,
};

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

document.getElementById("btn-force-collision-color")?.addEventListener("click", () => {
  synced.updateShape("r1", { color: "#ff0000" });
  console.log("[force-collision] sent COLOR-only edit (partial patch)");
});

document.getElementById("btn-force-collision-move")?.addEventListener("click", () => {
  synced.updateShape("r1", { x: 999, y: 999 });
  console.log("[force-collision] sent POSITION-only edit (partial patch)");
});
