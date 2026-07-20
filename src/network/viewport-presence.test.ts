/// <reference types="node" />
import { PresenceTracker } from "./presence.js";
import type { DataChannelTransport } from "./data-channel-transport.js";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

function makeLinkedPair(): [DataChannelTransport, DataChannelTransport] {
  let aListener: ((data: string) => void) | undefined;
  let bListener: ((data: string) => void) | undefined;
  const queueForA: string[] = [];
  const queueForB: string[] = [];

  const a = {
    send: (data: string) => { if (bListener) bListener(data); else queueForB.push(data); },
    onMessage: (l: (data: string) => void) => { aListener = l; while (queueForA.length) l(queueForA.shift()!); },
  } as unknown as DataChannelTransport;

  const b = {
    send: (data: string) => { if (aListener) aListener(data); else queueForA.push(data); },
    onMessage: (l: (data: string) => void) => { bListener = l; while (queueForB.length) l(queueForB.shift()!); },
  } as unknown as DataChannelTransport;

  return [a, b];
}

console.log("Test 1: cursor and viewport broadcasts MERGE rather than overwrite each other");
{
  const peerA = new PresenceTracker("peerA");
  const peerB = new PresenceTracker("peerB");
  const [linkA, linkB] = makeLinkedPair();
  peerA.attachTransport(linkA);
  peerB.attachTransport(linkB);

  peerA.broadcastCursor(100, 200);
  peerA.broadcastViewport({ x: 0, y: 0, zoom: 1.5 });

  console.log("  [debug] peerB.getOnlinePeers():", JSON.stringify(peerB.getOnlinePeers()));
  const seen = peerB.getOnlinePeers().find((p) => p.peerId === "peerA");
  assert(seen?.cursorX === 100 && seen?.cursorY === 200, "cursor position present after both broadcasts");
  assert(seen?.vpX === 0 && seen?.vpY === 0 && seen?.vpZoom === 1.5, "viewport ALSO present — one broadcast didn't erase the other");
}

console.log("\nTest 2: three concurrent peers, each broadcasting cursor AND viewport independently");
{
  const peerA = new PresenceTracker("peerA2");
  const peerB = new PresenceTracker("peerB2");
  const peerC = new PresenceTracker("peerC2");

  const [aToB, bToA] = makeLinkedPair();
  const [aToC, cToA] = makeLinkedPair();
  peerA.attachTransport(aToB);
  peerB.attachTransport(bToA);
  peerA.attachTransport(aToC);
  peerC.attachTransport(cToA);

  peerB.broadcastCursor(10, 10);
  peerB.broadcastViewport({ x: 5, y: 5, zoom: 2 });
  peerC.broadcastCursor(20, 20);
  peerC.broadcastViewport({ x: 15, y: 15, zoom: 0.5 });

  const bSeenByA = peerA.getOnlinePeers().find((p) => p.peerId === "peerB2");
  const cSeenByA = peerA.getOnlinePeers().find((p) => p.peerId === "peerC2");

  assert(bSeenByA?.cursorX === 10 && bSeenByA?.vpZoom === 2, "peerA correctly merges peerB's cursor and viewport");
  assert(cSeenByA?.cursorX === 20 && cSeenByA?.vpZoom === 0.5, "peerA correctly merges peerC's cursor and viewport, independently of peerB's");
  assert(bSeenByA?.vpZoom !== cSeenByA?.vpZoom, "peerB's and peerC's viewport states remain distinct, not accidentally shared");
}

console.log("\nTest 3: disconnect cleans up BOTH cursor and viewport state together");
{
  const peerA = new PresenceTracker("peerA3");
  const peerB = new PresenceTracker("peerB3");
  const [linkA, linkB] = makeLinkedPair();
  peerA.attachTransport(linkA);
  peerB.attachTransport(linkB);

  peerA.broadcastCursor(1, 1);
  peerA.broadcastViewport({ x: 1, y: 1, zoom: 1 });
  assert(peerB.getOnlinePeers().length === 1, "peerB sees peerA online with cursor+viewport data");

  peerB.detachTransport(linkB);
  assert(peerB.getOnlinePeers().length === 0, "after detach, peerA is fully removed — no orphaned cursor or viewport entries left behind");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
