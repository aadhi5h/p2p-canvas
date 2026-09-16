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
import { EncryptedTransport } from "./crypto/encrypted-transport.js";

const canvasEl = document.getElementById("app-canvas") as HTMLCanvasElement;
const state = new CanvasState();
const viewport = new Viewport();
startPlaceholderRenderer(canvasEl, state, viewport);

const peerId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
const provider = new CrdtProvider(peerId);
const synced = new SyncedCanvas(provider, state);
const presence = new PresenceTracker(peerId);
startCursorOverlay(presence, viewport);
startViewportOverlay(presence, viewport);

import("./render/webgpu/device.js").then(async ({ initWebGPU }) => {
  const webgpuCanvas = document.getElementById("webgpu-canvas") as HTMLCanvasElement | null;
  const statusEl = document.getElementById("webgpu-status")!;
  if (!webgpuCanvas) return;

  const gpu = await initWebGPU(webgpuCanvas);
  if (!gpu) {
    statusEl.textContent = "WebGPU: unavailable in this browser";
    statusEl.style.color = "#6B706C";
    return;
  }

  statusEl.textContent = "WebGPU: device + context initialized";
  statusEl.style.color = "#DFFF00";

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

synced.addShape({ id: "r1", type: "rect", x: 100, y: 100, width: 120, height: 80, color: "#4f8ef7", rotation: 0, zIndex: 0 });
synced.addShape({ id: "r2", type: "rect", x: 260, y: 180, width: 80, height: 80, color: "#f77c4f", rotation: 0, zIndex: 0 });

viewport.onChange(() => presence.broadcastViewport(viewport.get()));

window.addEventListener("mousemove", (event) => {
  const world = viewport.screenToWorld(event.clientX, event.clientY);
  presence.broadcastCursor(world.x, world.y);
});

const colorPicker = document.getElementById("color-picker") as HTMLInputElement;
let currentColor = colorPicker.value;
colorPicker.addEventListener("input", () => {
  currentColor = colorPicker.value;
});

let tool: "select" | "pen" = "select";
const penButton = document.getElementById("btn-tool-pen")!;
penButton.addEventListener("click", () => {
  tool = tool === "select" ? "pen" : "select";
  penButton.classList.toggle("active", tool === "pen");
});

let drawingPathId: string | undefined;
let drawingPoints: { x: number; y: number }[] = [];
let pathFlushScheduled = false;

function flushPathPoints() {
  pathFlushScheduled = false;
  if (drawingPathId) {
    synced.updateShape(drawingPathId, { points: [...drawingPoints] } as any);
  }
}

let draggingId: string | undefined;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragMoved = false;
let isPanning = false;
let lastPanScreenX = 0;
let lastPanScreenY = 0;

canvasEl.addEventListener("mousedown", (event) => {
  const world = viewport.screenToWorld(event.clientX, event.clientY);

  if (tool === "pen") {
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    drawingPathId = id;
    drawingPoints = [{ x: world.x, y: world.y }];
    synced.addShape({
      id, type: "path", points: [...drawingPoints],
      color: currentColor, strokeWidth: 3,
      x: world.x, y: world.y, rotation: 0, zIndex: state.getAllShapes().length,
    } as any);
    return;
  }

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
  const world = viewport.screenToWorld(event.clientX, event.clientY);

  if (drawingPathId) {
    drawingPoints.push({ x: world.x, y: world.y });
    if (!pathFlushScheduled) {
      pathFlushScheduled = true;
      requestAnimationFrame(flushPathPoints);
    }
    return;
  }

  if (draggingId) {
    dragMoved = true;
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
  if (drawingPathId) {
    flushPathPoints();
    drawingPathId = undefined;
    drawingPoints = [];
  }
  draggingId = undefined;
  isPanning = false;
});

canvasEl.addEventListener("wheel", (event) => {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.1 : 0.9;
  viewport.zoomAt(factor, event.clientX, event.clientY);
}, { passive: false });

canvasEl.addEventListener("click", (event) => {
  if (tool !== "select") return;
  if (dragMoved) {
    dragMoved = false;
    return;
  }
  if (isPanning) return;
  const world = viewport.screenToWorld(event.clientX, event.clientY);
  const hit = hitTest(state.getAllShapes(), world.x, world.y);
  if (hit) return;

  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const zIndex = state.getAllShapes().length;

  if (Math.random() < 0.5) {
    synced.addShape({
      id, type: "rect",
      x: world.x - 25, y: world.y - 25, width: 50, height: 50,
      color: currentColor, rotation: Math.random() * 45, zIndex,
    });
  } else {
    synced.addShape({
      id, type: "circle",
      x: world.x, y: world.y, radius: 25,
      color: currentColor, rotation: 0, zIndex,
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
    offlineIndicator.textContent = "OFFLINE";
    offlineIndicator.classList.remove("online");
  } else {
    offlineIndicator.textContent = `ONLINE · ${count} PEER${count === 1 ? "" : "S"}`;
    offlineIndicator.classList.add("online");
  }
}

updateOfflineIndicator();

function renderPeerList() {
  peerListEl.innerHTML = Array.from(peerStatuses.entries())
    .map(([id, status]) => {
      const color = status === "connected" ? "#00FF55" : status === "failed" || status === "closed" ? "#6B706C" : "#DFFF00";
      return `<div class="peer-chip"><span class="peer-mark" style="background:${color}"></span>${id.slice(0, 6)}</div>`;
    })
    .join("");
}

manager.onStatusChange((peerId, status) => {
  peerStatuses.set(peerId, status);
  renderPeerList();
  updateOfflineIndicator();
});

const encryptedTransports = new Map<any, EncryptedTransport>();

manager.onTransportReady((_peerId, transport) => {
  const encrypted = new EncryptedTransport(transport);
  encryptedTransports.set(transport, encrypted);
  synced.attachTransport(encrypted);
  presence.attachTransport(encrypted);
});

manager.onDisconnect((peerId, transport) => {
  const encrypted = transport ? encryptedTransports.get(transport) : undefined;
  if (encrypted) {
    provider.detachTransport(encrypted);
    presence.detachTransport(encrypted);
    encryptedTransports.delete(transport!);
  }
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
  const colors = ["#00C853", "#00FF55", "#7DFF00", "#DFFF00", "#FFFF00"];
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
  synced.updateShape("r1", { color: "#DFFF00" });
  console.log("[force-collision] sent COLOR-only edit (partial patch)");
});

document.getElementById("btn-force-collision-move")?.addEventListener("click", () => {
  synced.updateShape("r1", { x: 999, y: 999 });
  console.log("[force-collision] sent POSITION-only edit (partial patch)");
});