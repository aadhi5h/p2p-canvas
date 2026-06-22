/// <reference types="node" />
import { CrdtDocument } from "./document.js";
import type { Shape } from "../canvas/types.js";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

console.log("Test 1: concurrent creation of DIFFERENT shapes — both must survive");
{
  const peerA = new CrdtDocument("peerA");
  const peerB = new CrdtDocument("peerB");

  const shapeFromA: Shape = { id: "shape-a", type: "rect", x: 0, y: 0, width: 10, height: 10, color: "red" };
  const shapeFromB: Shape = { id: "shape-b", type: "rect", x: 50, y: 50, width: 10, height: 10, color: "blue" };

  const opA = peerA.set("shape-a", shapeFromA);
  const opB = peerB.set("shape-b", shapeFromB);

  // Cross-apply in opposite order on each peer
  peerA.applyOp(opB);
  peerB.applyOp(opA);

  assert(peerA.getAllShapes().length === 2, "peerA ends up with both shapes");
  assert(peerB.getAllShapes().length === 2, "peerB ends up with both shapes");
  assert(
    JSON.stringify(peerA.getAllShapes().sort((a, b) => a.id.localeCompare(b.id))) ===
    JSON.stringify(peerB.getAllShapes().sort((a, b) => a.id.localeCompare(b.id))),
    "both peers converge to the identical set of shapes"
  );
}

console.log("\nTest 2: N peers each creating a unique shape simultaneously — no shape lost");
{
  const peerCount = 5;
  const peers = Array.from({ length: peerCount }, (_, i) => new CrdtDocument(`peer-${i}`));
  const ops = peers.map((peer, i) =>
    peer.set(`shape-${i}`, { id: `shape-${i}`, type: "rect", x: i * 10, y: 0, width: 10, height: 10, color: "green" })
  );

  // Every peer applies every OTHER peer's op, each in a different random-ish order
  for (let i = 0; i < peers.length; i++) {
    const othersOps = ops.filter((_, j) => j !== i);
    // reverse order for odd i, forward for even i — just to vary it deterministically
    const ordered = i % 2 === 0 ? othersOps : [...othersOps].reverse();
    for (const op of ordered) peers[i].applyOp(op);
  }

  const allHaveAllShapes = peers.every((p) => p.getAllShapes().length === peerCount);
  assert(allHaveAllShapes, `all ${peerCount} peers end up with all ${peerCount} shapes, regardless of apply order`);
}

console.log("\nTest 3: edge case — two peers concurrently create a shape with the SAME id");
{
  const peerA = new CrdtDocument("peerA");
  const peerB = new CrdtDocument("peerB");

  // Both peers independently "create" id "collision" without knowing about each other
  const opA = peerA.set("collision", { id: "collision", type: "rect", x: 1, y: 1, width: 10, height: 10, color: "from-a" });
  const opB = peerB.set("collision", { id: "collision", type: "rect", x: 2, y: 2, width: 10, height: 10, color: "from-b" });

  peerA.applyOp(opB);
  peerB.applyOp(opA);

  assert(peerA.getAllShapes().length === 1, "no duplicate/corrupted entries — exactly one shape survives on peerA");
  assert(peerB.getAllShapes().length === 1, "same on peerB");
  assert(
    peerA.getShape("collision")?.color === peerB.getShape("collision")?.color,
    "both peers deterministically agree on WHICH one won (no split-brain)"
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
