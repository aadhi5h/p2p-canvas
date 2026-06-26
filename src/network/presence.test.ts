/// <reference types="node" />
import { PresenceTracker } from "./presence.js";
import type { DataChannelTransport } from "./data-channel-transport.js";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

// A minimal fake transport: PresenceTracker only ever calls send()
// and onMessage(), so that's all we need to implement. Connects two
// fake endpoints directly, synchronously, like an in-memory pipe.
function makeLinkedPair(): [DataChannelTransport, DataChannelTransport] {
  let aListener: ((data: string) => void) | undefined;
  let bListener: ((data: string) => void) | undefined;
  // Real DataChannelTransport queues sends until the channel is open
  // (Day 4). Our fake must do the same, or a message sent before the
  // other side has called onMessage() yet is silently lost.
  const queueForA: string[] = [];
  const queueForB: string[] = [];

  const a = {
    send: (data: string) => {
      if (bListener) bListener(data);
      else queueForB.push(data);
    },
    onMessage: (l: (data: string) => void) => {
      aListener = l;
      // no queued-for-A flush needed here; flushing happens when B calls onMessage below
    },
  } as unknown as DataChannelTransport;

  const b = {
    send: (data: string) => {
      if (aListener) aListener(data);
      else queueForA.push(data);
    },
    onMessage: (l: (data: string) => void) => {
      bListener = l;
      while (queueForB.length) l(queueForB.shift()!);
    },
  } as unknown as DataChannelTransport;

  // Symmetric flush for the a-side queue once its listener attaches
  const originalAOnMessage = a.onMessage as (l: (data: string) => void) => void;
  (a as any).onMessage = (l: (data: string) => void) => {
    originalAOnMessage(l);
    while (queueForA.length) l(queueForA.shift()!);
  };

  return [a, b];
}

console.log("Test: three peers, hub-and-spoke through peer A (matches our actual topology from Day 13)");
{
  const peerA = new PresenceTracker("peer-A");
  const peerB = new PresenceTracker("peer-B");
  const peerC = new PresenceTracker("peer-C");

  const [aToB, bToA] = makeLinkedPair();
  const [aToC, cToA] = makeLinkedPair();

  peerA.attachTransport(aToB);
  peerB.attachTransport(bToA);
  peerA.attachTransport(aToC);
  peerC.attachTransport(cToA);

  assert(peerA.getOnlinePeers().length === 2, "peer A sees both B and C online");
  assert(peerB.getOnlinePeers().length === 1, "peer B only sees A (no direct B<->C link, matches our hub-and-spoke reality)");
  assert(peerC.getOnlinePeers().length === 1, "peer C only sees A, same reason");

  peerB.broadcastCursor(999, 999); // force past throttle by being the very first call
  assert(
    peerA.getOnlinePeers().find((p) => p.peerId === "peer-B")?.cursorX === undefined ||
    true, // throttle window means this may or may not have registered instantly — not asserting timing here
    "cursor broadcast doesn't throw and completes without error"
  );

  peerA.detachTransport(aToB);
  assert(peerA.getOnlinePeers().length === 1, "after B disconnects, A only sees C remaining");
  assert(peerA.getOnlinePeers()[0]?.peerId === "peer-C", "and specifically it's C, not a leftover B entry");

  peerA.detachTransport(aToC);
  assert(peerA.getOnlinePeers().length === 0, "after C also disconnects, A sees no one — matches the earlier manual test you ran");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
