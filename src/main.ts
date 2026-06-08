import { CanvasState } from "./canvas/state.js";
import { startPlaceholderRenderer } from "./render/placeholder-renderer.js";
import { PeerConnection } from "./network/peer-connection.js";
import { DataChannelTransport } from "./network/data-channel-transport.js";
import { waitForIceGatheringComplete, encodeSignal, decodeSignal } from "./network/manual-signaling.js";

const canvasEl = document.getElementById("app-canvas") as HTMLCanvasElement;
const state = new CanvasState();
startPlaceholderRenderer(canvasEl, state);

state.addShape({ id: "r1", type: "rect", x: 100, y: 100, width: 120, height: 80, color: "#4f8ef7" });
state.addShape({ id: "r2", type: "rect", x: 260, y: 180, width: 80, height: 80, color: "#f77c4f" });

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
  t.onMessage((data) => console.log("[received]", data));
  peer.raw.onconnectionstatechange = () => setStatus(peer.connectionState);
  setStatus(peer.connectionState); // report current state immediately, in case we attached too late to catch it
}

// Wraps a click handler so errors are ALWAYS visible in console,
// instead of silently dying inside an unhandled promise rejection.
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

(window as any).debug = { get transport() { return transport; }, peer, state };
