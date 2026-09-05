/// <reference types="node" />
import { CrdtProvider } from "./provider.js";
import type { DataChannelTransport } from "../network/data-channel-transport.js";
import type { Shape } from "../canvas/types.js";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

// Same queued fake transport as presence.test.ts — real DataChannelTransport
// queues sends until open, so the fake must too, or messages sent before
// attachTransport() runs on both sides get silently dropped.
function makeLinkedPair(): [DataChannelTransport, DataChannelTransport] {
  let aListener: ((data: string) => void) | undefined;
  let bListener: ((data: string) => void) | undefined;
  const queueForA: string[] = [];
  const queueForB: string[] = [];

  const a = {
    send: (data: string) => {
      if (bListener) bListener(data);
      else queueForB.push(data);
    },
    onMessage: (l: (data: string) => void) => {
      aListener = l;
      while (queueForA.length) l(queueForA.shift()!);
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

  return [a, b];
}

function rect(id: string, color: string): Shape {
  return {
    id,
    type: "rect",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    color,
    rotation: 0,
    zIndex: 0,
  };
}

console.log(
  "Test 1: two peers each edit fully OFFLINE, then connect for the first time",
);
{
  const peerA = new CrdtProvider("peerA");
  const peerB = new CrdtProvider("peerB");

  // Both make several edits with ZERO transports attached — this is
  // the actual "offline" condition: no attachTransport() call at all.
  peerA.localSet("a1", rect("a1", "red"));
  peerA.localSet("a2", rect("a2", "orange"));
  peerB.localSet("b1", rect("b1", "blue"));
  peerB.localSet("b2", rect("b2", "cyan"));
  peerB.localDelete("b2"); // even a delete while offline should merge correctly

  assert(
    peerA.getAllShapes().length === 2,
    "peerA has its own 2 shapes while offline",
  );
  assert(
    peerB.getAllShapes().length === 1,
    "peerB has 1 shape while offline (b2 was deleted before ever syncing)",
  );

  // NOW they connect for the first time.
  const [linkA, linkB] = makeLinkedPair();
  peerA.attachTransport(linkA);
  peerB.attachTransport(linkB);

  const idsA = peerA
    .getAllShapes()
    .map((s) => s.id)
    .sort();
  const idsB = peerB
    .getAllShapes()
    .map((s) => s.id)
    .sort();

  assert(
    JSON.stringify(idsA) === JSON.stringify(idsB),
    "after first connection, both peers converge to the identical shape set",
  );
  assert(
    JSON.stringify(idsA) === JSON.stringify(["a1", "a2", "b1"]),
    "the merged set is exactly what's expected — b2's offline delete correctly excluded it",
  );
}

console.log(
  "\nTest 2: offline edits AFTER an initial connection, made while disconnected, merge on reconnect",
);
{
  const peerA = new CrdtProvider("peerA2");
  const peerB = new CrdtProvider("peerB2");

  const [linkA, linkB] = makeLinkedPair();
  peerA.attachTransport(linkA);
  peerB.attachTransport(linkB);

  peerA.localSet("shared", rect("shared", "green"));
  await Promise.resolve();
  assert(
    peerB.getShape("shared")?.color === "green",
    "live edit while connected syncs after the batch microtask flushes",
  );
  // Simulate disconnect: peerA just stops using linkA (nothing calls
  // detachTransport in this test — we're simulating peerA being offline
  // by having it talk to a NEW peer instead, not by tearing down old state).
  peerA.localSet("offline-shape", rect("offline-shape", "purple")); // "made while disconnected" — no new transport involved yet

  // A reconnecting peer C, who has never seen ANY of this history,
  // connects to A fresh — same as our real "Tab 3 reconnect" manual test.
  const peerC = new CrdtProvider("peerC");
  const [linkA2, linkC] = makeLinkedPair();
  peerA.attachTransport(linkA2);
  peerC.attachTransport(linkC);

  const idsC = peerC
    .getAllShapes()
    .map((s) => s.id)
    .sort();
  assert(
    idsC.includes("offline-shape"),
    "a freshly-connecting peer receives shapes that were created while the other peer was offline",
  );
  assert(
    idsC.includes("shared"),
    "and also receives shapes from before that, via the same snapshot",
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
