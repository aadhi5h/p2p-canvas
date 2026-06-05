import type { Shape, ShapeId } from "../canvas/types";

// A Lamport timestamp: a monotonically increasing counter, plus the
// id of the peer that produced it. The peerId is only a tie-breaker
// for when two peers produce the exact same counter value.
export interface LamportTimestamp {
  counter: number;
  peerId: string;
}

// Returns true if `a` should win over `b` under Last-Writer-Wins.
export function isNewer(a: LamportTimestamp, b: LamportTimestamp): boolean {
  if (a.counter !== b.counter) return a.counter > b.counter;
  return a.peerId > b.peerId; // deterministic tie-break, same on every peer
}

export type CrdtOpType = "set" | "delete";

// A single replicated operation: "shape X is now Y, as of timestamp T".
// This is what eventually gets sent over the wire (Day 8+).
export interface CrdtOp {
  type: CrdtOpType;
  shapeId: ShapeId;
  value: Shape | null; // null for deletes
  timestamp: LamportTimestamp;
}
