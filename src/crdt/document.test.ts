/// <reference types="node" />
import { CrdtDocument } from "./document.js";
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

function shapesEqual(a: Shape | undefined, b: Shape | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log("Test 1: concurrent set on same shape converges");
{
  const peerA = new CrdtDocument("peerA");
  const peerB = new CrdtDocument("peerB");
  const rect = (color: string): Shape => ({ id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10, color });

  const opA = peerA.set("r1", rect("red"));
  const opB = peerB.set("r1", rect("blue"));

  // Apply in OPPOSITE order on each peer — the actual test
  peerA.applyOp(opB);
  peerB.applyOp(opA);

  assert(shapesEqual(peerA.getShape("r1"), peerB.getShape("r1")), "both peers converge to the same shape regardless of apply order");
}

console.log("Test 2: higher counter always wins, regardless of arrival order");
{
  const peer = new CrdtDocument("peerX");
  peer.set("r1", { id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10, color: "red" });

  // Manually construct a "later" op as if it came from elsewhere with a higher counter
  const laterOp = {
    type: "set" as const,
    shapeId: "r1",
    value: { id: "r1", type: "rect" as const, x: 0, y: 0, width: 10, height: 10, color: "green" },
    timestamp: { counter: 999, peerId: "peerY" },
  };
  const earlierOp = {
    type: "set" as const,
    shapeId: "r1",
    value: { id: "r1", type: "rect" as const, x: 0, y: 0, width: 10, height: 10, color: "purple" },
    timestamp: { counter: 1, peerId: "peerY" },
  };

  // Apply the EARLIER op after the LATER one — it must be ignored
  peer.applyOp(laterOp);
  peer.applyOp(earlierOp);

  assert(peer.getShape("r1")?.color === "green", "stale op with lower counter is ignored even if applied last");
}

console.log("Test 3: delete wins over a stale concurrent set");
{
  const peerA = new CrdtDocument("peerA");
  const peerB = new CrdtDocument("peerB");
  peerA.set("r1", { id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10, color: "red" });

  const deleteOp = peerA.delete("r1");
  const staleSetOp = { // simulate a peer that hadn't seen the delete yet, with a lower counter
    type: "set" as const,
    shapeId: "r1",
    value: { id: "r1", type: "rect" as const, x: 0, y: 0, width: 10, height: 10, color: "blue" },
    timestamp: { counter: deleteOp.timestamp.counter - 1, peerId: "peerB" },
  };

  peerB.applyOp(deleteOp);
  peerB.applyOp(staleSetOp);

  assert(peerB.getShape("r1") === undefined, "delete with higher counter beats a stale concurrent set");
}

console.log("Test 4: tie-break on equal counters is deterministic by peerId");
{
  const peerA = new CrdtDocument("aaa");
  const peerB = new CrdtDocument("zzz");

  // Force both to the same counter value by constructing ops manually
  const opFromA = {
    type: "set" as const,
    shapeId: "r1",
    value: { id: "r1", type: "rect" as const, x: 0, y: 0, width: 10, height: 10, color: "from-a" },
    timestamp: { counter: 5, peerId: "aaa" },
  };
  const opFromZ = {
    type: "set" as const,
    shapeId: "r1",
    value: { id: "r1", type: "rect" as const, x: 0, y: 0, width: 10, height: 10, color: "from-z" },
    timestamp: { counter: 5, peerId: "zzz" },
  };

  peerA.applyOp(opFromA);
  peerA.applyOp(opFromZ);
  peerB.applyOp(opFromZ);
  peerB.applyOp(opFromA);

  assert(peerA.getShape("r1")?.color === "from-z", "peer A resolves tie to higher peerId (zzz > aaa)");
  assert(peerB.getShape("r1")?.color === "from-z", "peer B resolves the SAME tie identically, regardless of apply order");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
