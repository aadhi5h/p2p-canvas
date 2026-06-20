/// <reference types="node" />
import { CrdtDocument } from "./document.js";
import type { Shape } from "../canvas/types.js";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

console.log("Concurrent edits to DIFFERENT fields of the SAME shape");
console.log("(documents current whole-value LWW behavior — see Day 37 for a real fix)\n");
{
  const peerA = new CrdtDocument("peerA");
  const peerB = new CrdtDocument("peerB");

  const original: Shape = { id: "r1", type: "rect", x: 0, y: 0, width: 50, height: 50, color: "red" };
  peerA.set("r1", original);
  peerB.applyOp({ type: "set", shapeId: "r1", value: original, timestamp: { counter: 1, peerId: "peerA" } });

  // Peer A changes only color. Peer B changes only position. "Concurrent"
  // meaning: each is built from the SAME prior state, unaware of the other.
  const opFromA = peerA.set("r1", { ...original, color: "blue" });
  const opFromB = peerB.set("r1", { ...original, x: 200, y: 200 });

  peerA.applyOp(opFromB);
  peerB.applyOp(opFromA);

  const resultA = peerA.getShape("r1")!;
  const resultB = peerB.getShape("r1")!;

  assert(JSON.stringify(resultA) === JSON.stringify(resultB), "both peers converge to the SAME final value (this always holds)");

  // Whichever op had the higher Lamport counter wins WHOLESALE.
  // Both peerA.set and peerB.set happened at counter=2 on their own
  // clocks, so the peerId tie-break decides: "peerB" > "peerA" lexically.
  const bWon = resultA.x === 200 && resultA.color === "red";
  const aWon = resultA.color === "blue" && resultA.x === 0;

  assert(bWon || aWon, "exactly one full edit wins — never a merge of both");
  if (bWon) console.log("  → peerB's op won: position changed, color edit from peerA was LOST");
  if (aWon) console.log("  → peerA's op won: color changed, position edit from peerB was LOST");

  console.log(`\n  This data loss is expected under whole-value LWW.`);
  console.log(`  Day 37 (deterministic object merge policy) addresses field-level merging.`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
