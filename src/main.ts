import { CanvasState } from "./canvas/state.js";
import { startPlaceholderRenderer } from "./render/placeholder-renderer.js";
import { PeerConnection } from "./network/peer-connection.js";
import { DataChannelTransport } from "./network/data-channel-transport.js";
import { waitForIceGatheringComplete, encodeSignal, decodeSignal } from "./network/manual-signaling.js";
import { CrdtDocument } from "./crdt/document.js";
import { SyncedCanvas } from "./crdt/synced-canvas.js";

const canvasEl = document.getElementById("app-canvas") as HTMLCanvasElement;
const state = new CanvasState();
startPlaceholderRenderer(canvasEl, state);

const peerId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
const document_ = new CrdtDocument(peerId);
const synced = new SyncedCanvas(document_, state);

// Seed a couple of shapes through the synced path (not raw state)
// so they're proper CRDT entries that will replicate correctly.
synced.addShape({ id: "r1", type: "rect", x: 100, y: 100, width: 120, height: 80, color: "#4f8ef7" });
synced.addShape({ id: "r2", type: "rect", x: 260, y: 180, width: 80, height: 80, color: "#f77c4f" });

// Click-to-create: the actual way to test cross-tab sync (Day 9).
canvasEl.addEventListener("click", (event) => {
  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const colors = ["#4f8ef7", "#f77c4f", "#4ff78e", "#f74f8e", "#f7e14f"];
  synced.addShape({
    id,
    type: "rect",
    x: event.clientX - 25,
    y: event.clientY - 25,
    width: 50,
    height: 50,
    color: colors[Math.floor(Math.random() * colors.length)],
  });
});

const statusEl = document.getElementById("conn-status")!;
const offerOut = document.getElementById("offer-out") as HTMLTextAreaElement;
const offerIn = document.getElementById("offer-in") as HTMLTextAreaElement;
const answerOut = document.getElementById("answer-out") as HTMLTextAreaElement;
const answerIn = document.getElementById("answer-in") as HTMLTextAreaElement;

const peer = new PeerConnection();
let transport: DataChannelTransport | undefined;
let hasCreatedChannel = false;

function setStatus(text: string) {
  statusEl.textContent = text;
  console.log("[connection]", text);
}

function wireTransport(t: DataChannelTransport) {
  transport = t;
  synced.attachTransport(t);
  peer.raw.onconnectionstatechange = () => setStatus(peer.connectionState);
  setStatus(peer.connectionState); // in case we attached after the state already changed
}

function safeHandler(fn: () => Promise<void>) {
  return () => {
    fn().catch((err) => {
      console.error("[handler error]", err);
      setStatus("error — see console");
    });
  };
}

document.getElementById("btn-create-offer")!.addEventListener("click", safeHandler(async () => {
  if (hasCreatedChannel) {
    console.warn("Offer already created on this connection — refresh the page to start over.");
    return;
  }
  hasCreatedChannel = true;
  const t = DataChannelTransport.createInitiator(peer);
  wireTransport(t);
  await peer.createOffer();
  setStatus("gathering ICE candidates...");
  await waitForIceGatheringComplete(peer);
  offerOut.value = encodeSignal(peer.raw.localDescription!);
  setStatus("offer created — send this blob to the other tab");
}));

document.getElementById("btn-join")!.addEventListener("click", safeHandler(async () => {
  peer.raw.ondatachannel = (event) => wireTransport(DataChannelTransport.fromExisting(event.channel));
  const remoteOffer = decodeSignal(offerIn.value);
  await peer.createAnswer(remoteOffer);
  setStatus("gathering ICE candidates...");
  await waitForIceGatheringComplete(peer);
  answerOut.value = encodeSignal(peer.raw.localDescription!);
  setStatus("answer created — send this blob back to the initiator");
}));

document.getElementById("btn-complete")!.addEventListener("click", safeHandler(async () => {
  const remoteAnswer = decodeSignal(answerIn.value);
  await peer.acceptAnswer(remoteAnswer);
  setStatus("connecting...");
}));

(window as any).debug = { get transport() { return transport; }, peer, state, document: document_, synced };
