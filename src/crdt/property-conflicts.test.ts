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

console.log("Test 1: concurrent edits to DIFFERENT fields both survive (the actual Day 37 fix)");
{
  const peerA = new CrdtDocument("peerA");
  const peerB = new CrdtDocument("peerB");
  const base = baseRect();

  peerA.applyOp({ type: "set", shapeId: "r1", fields: base as unknown as Record<string, unknown>, timestamp: { counter: 1, peerId: "seed" } });
  peerB.applyOp({ type: "set", shapeId: "r1", fields: base as unknown as Record<string, unknown>, timestamp: { counter: 1, peerId: "seed" } });

  const colorOp = peerA.update("r1", { color: "#ff0000" });
  const moveOp = peerB.update("r1", { x: 999, y: 999 });

  peerA.applyOp(moveOp);
  peerB.applyOp(colorOp);

  const resultA = peerA.getShape("r1")!;
  const resultB = peerB.getShape("r1")!;

  assert(JSON.stringify(resultA) === JSON.stringify(resultB), "both peers converge to the identical merged shape");
  assert(resultA.color === "#ff0000", "color edit survived");
  assert(resultA.x === 999 && resultA.y === 999, "position edit ALSO survived — no data loss");
}

console.log("\nTest 2: concurrent edits to the SAME field still resolve via LWW (not both survive)");
{
  const peerA = new CrdtDocument("peerA2");
  const peerB = new CrdtDocument("peerB2");
  const base = baseRect();

  peerA.applyOp({ type: "set", shapeId: "r1", fields: base as unknown as Record<string, unknown>, timestamp: { counter: 1, peerId: "seed" } });
  peerB.applyOp({ type: "set", shapeId: "r1", fields: base as unknown as Record<string, unknown>, timestamp: { counter: 1, peerId: "seed" } });

  const opA = peerA.update("r1", { color: "#ff0000" });
  const opB = peerB.update("r1", { color: "#00ff00" });

  peerA.applyOp(opB);
  peerB.applyOp(opA);

  const resultA = peerA.getShape("r1")!;
  const resultB = peerB.getShape("r1")!;

  assert(resultA.color === resultB.color, "both peers agree on which color won");
  assert(resultA.color === "#ff0000" || resultA.color === "#00ff00", "exactly one color value wins for a same-field conflict");
}

console.log("\nTest 3: three-way concurrent edit — each peer touches a different field");
{
  const peerA = new CrdtDocument("peerA3");
  const peerB = new CrdtDocument("peerB3");
  const peerC = new CrdtDocument("peerC3");
  const base = baseRect();

  for (const p of [peerA, peerB, peerC]) {
    p.applyOp({ type: "set", shapeId: "r1", fields: base as unknown as Record<string, unknown>, timestamp: { counter: 1, peerId: "seed" } });
  }

  const opColor = peerA.update("r1", { color: "#123456" });
  const opPos = peerB.update("r1", { x: 777, y: 888 });
  const opRotation = peerC.update("r1", { rotation: 45 });

  for (const p of [peerA, peerB, peerC]) {
    for (const op of [opColor, opPos, opRotation]) {
      if (p !== (op === opColor ? peerA : op === opPos ? peerB : peerC)) p.applyOp(op);
    }
  }

  const final = peerA.getShape("r1")!;
  assert(final.color === "#123456", "peerA's color edit present");
  assert(final.x === 777 && final.y === 888, "peerB's position edit present");
  assert(final.rotation === 45, "peerC's rotation edit present");
  assert(
    JSON.stringify(peerA.getShape("r1")) === JSON.stringify(peerB.getShape("r1")) &&
    JSON.stringify(peerB.getShape("r1")) === JSON.stringify(peerC.getShape("r1")),
    "all three peers converge to the identical fully-merged shape"
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
