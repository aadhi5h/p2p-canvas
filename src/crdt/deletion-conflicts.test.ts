/// <reference types="node" />
import { CrdtDocument, DELETED_FIELD } from "./document.js";
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

console.log("Test 1: delete concurrent with a partial edit to a DIFFERENT field — delete wins, edit doesn't revive");
{
  const peerA = new CrdtDocument("peerA");
  const peerB = new CrdtDocument("peerB");
  const base = baseRect();
  for (const p of [peerA, peerB]) {
    p.applyOp({ type: "set", shapeId: "r1", fields: base as unknown as Record<string, unknown>, timestamp: { counter: 1, peerId: "seed" } });
  }
  const deleteOp = peerA.delete("r1");
  const colorOp = peerB.update("r1", { color: "#ff0000" });
  peerA.applyOp(colorOp);
  peerB.applyOp(deleteOp);
  assert(peerA.getShape("r1") === undefined, "peerA sees the shape as deleted");
  assert(peerB.getShape("r1") === undefined, "peerB agrees — a partial field edit never revives a deleted shape");
}

console.log("\nTest 2: only a full RECREATE (set), not a partial update, revives a deleted shape");
{
  const peer = new CrdtDocument("peerX");
  const base = baseRect();
  peer.applyOp({ type: "set", shapeId: "r1", fields: base as unknown as Record<string, unknown>, timestamp: { counter: 1, peerId: "seed" } });
  peer.delete("r1");
  assert(peer.getShape("r1") === undefined, "shape is deleted");
  peer.update("r1", { color: "#00ff00" });
  assert(peer.getShape("r1") === undefined, "a partial update does NOT revive it — still deleted, by design");
  peer.set("r1", { ...base, color: "#00ff00" });
  assert(peer.getShape("r1") !== undefined, "a full set() (recreate) DOES revive it");
  assert(peer.getShape("r1")?.color === "#00ff00", "revived shape carries the recreated value");
}

console.log("\nTest 3: a stale delete cannot override a LATER recreate");
{
  const peer = new CrdtDocument("peerY");
  const base = baseRect();
  peer.applyOp({ type: "set", shapeId: "r1", fields: base as unknown as Record<string, unknown>, timestamp: { counter: 1, peerId: "seed" } });
  peer.set("r1", { ...base, color: "#00ff00" });
  const staleDelete = { type: "delete" as const, shapeId: "r1", timestamp: { counter: 1, peerId: "someone-else" } };
  peer.applyOp(staleDelete);
  assert(peer.getShape("r1") !== undefined, "stale delete (counter 1) does not override the later recreate (counter 2)");
  assert(peer.getShape("r1")?.color === "#00ff00", "the recreated shape's value remains intact");
}

console.log("\nTest 4: tie-break between a delete and a recreate at EXACTLY the same counter");
{
  const peerLow = new CrdtDocument("aaa");
  const peerHigh = new CrdtDocument("zzz");
  const base = baseRect();
  for (const p of [peerLow, peerHigh]) {
    p.applyOp({ type: "set", shapeId: "r1", fields: base as unknown as Record<string, unknown>, timestamp: { counter: 1, peerId: "seed" } });
  }
  const deleteOp = { type: "delete" as const, shapeId: "r1", timestamp: { counter: 5, peerId: "aaa" } };
  const recreateOp = { type: "set" as const, shapeId: "r1", fields: { ...base, color: "#00ff00", [DELETED_FIELD]: false }, timestamp: { counter: 5, peerId: "zzz" } };
  peerLow.applyOp(deleteOp);
  peerLow.applyOp(recreateOp);
  peerHigh.applyOp(recreateOp);
  peerHigh.applyOp(deleteOp);
  assert(JSON.stringify(peerLow.getShape("r1")) === JSON.stringify(peerHigh.getShape("r1")), "both peers converge to the identical outcome regardless of apply order");
  assert(peerLow.isDeleted("r1") === false, "peerId 'zzz' > 'aaa', so the recreate wins the tie — shape is alive");
  assert(peerLow.getShape("r1")?.color === "#00ff00", "and carries the recreate's color");
}

console.log("\nTest 5 (the actual Day 42 fix): a recreate correctly revives the shape on OTHER peers, not just locally");
{
  const peerA = new CrdtDocument("peerA5");
  const peerB = new CrdtDocument("peerB5");
  const base = baseRect();
  const createOp = peerA.set("r1", base);
  peerB.applyOp(createOp);
  const deleteOp = peerA.delete("r1");
  peerB.applyOp(deleteOp);
  assert(peerB.getShape("r1") === undefined, "peerB correctly sees the delete");
  const recreateOp = peerA.set("r1", { ...base, color: "#00ff00" });
  peerB.applyOp(recreateOp);
  assert(peerB.getShape("r1") !== undefined, "peerB correctly revives the shape — tombstone now travels with the broadcast op");
  assert(peerB.getShape("r1")?.color === "#00ff00", "and carries the recreated value");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
