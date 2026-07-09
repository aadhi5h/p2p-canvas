/// <reference types="node" />
import { CrdtDocument } from "./document.js";
import type { Shape } from "../canvas/types.js";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

function baseRect(): Shape {
  return { id: "r1", type: "rect", x: 100, y: 100, width: 120, height: 80, color: "#4f8ef7", rotation: 0, zIndex: 0 };
}

console.log("Test: two peers concurrently move the SAME shape to DIFFERENT positions");
console.log("(this is the automated version of the live two-tab experiment from Day 33)\n");
{
  const peerA = new CrdtDocument("peerA");
  const peerB = new CrdtDocument("peerB");

  // Both start from the identical known base — mirrors clicking
  // "FORCE Collision" buttons that build from a fixed base rather
  // than merging with live state, which is what makes this a TRUE
  // concurrent edit rather than an accidental sequential one.
  const base = baseRect();
  peerA.applyOp({ type: "set", shapeId: "r1", fields: base, timestamp: { counter: 1, peerId: "seed" } });
  peerB.applyOp({ type: "set", shapeId: "r1", fields: base, timestamp: { counter: 1, peerId: "seed" } });

  const moveA = peerA.set("r1", { ...base, x: 200, y: 200 });
  const moveB = peerB.set("r1", { ...base, x: 500, y: 500 });

  // Cross-apply in opposite order — the actual race condition
  peerA.applyOp(moveB);
  peerB.applyOp(moveA);

  const resultA = peerA.getShape("r1")!;
  const resultB = peerB.getShape("r1")!;

  assert(JSON.stringify(resultA) === JSON.stringify(resultB), "both peers converge to the IDENTICAL final position, regardless of apply order");

  const aWon = resultA.x === 200 && resultA.y === 200;
  const bWon = resultA.x === 500 && resultA.y === 500;
  assert(aWon || bWon, "exactly one peer's move wins outright — position is never a blend/average of both");

  const isBlend = !aWon && !bWon;
  assert(!isBlend, "specifically confirms NO averaging or partial merge occurred (would indicate a bug, not expected LWW behavior)");
}

console.log("\nTest: N peers all concurrently move the same shape — still exactly one winner");
{
  const peerCount = 6;
  const peers = Array.from({ length: peerCount }, (_, i) => new CrdtDocument(`peer-${i}`));
  const base = baseRect();
  for (const p of peers) {
    p.applyOp({ type: "set", shapeId: "r1", fields: base, timestamp: { counter: 1, peerId: "seed" } });
  }

  const moves = peers.map((p, i) => p.set("r1", { ...base, x: i * 111, y: i * 111 }));

  // Every peer applies every other peer's move, in a different order each time
  for (let i = 0; i < peers.length; i++) {
    const others = moves.filter((_, j) => j !== i);
    const ordered = i % 2 === 0 ? others : [...others].reverse();
    for (const op of ordered) peers[i].applyOp(op);
  }

  const finalPositions = peers.map((p) => JSON.stringify(p.getShape("r1")));
  const allSame = finalPositions.every((pos) => pos === finalPositions[0]);
  assert(allSame, `all ${peerCount} peers converge to the SAME single winning position, regardless of their individual apply order`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
