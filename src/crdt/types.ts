import type { ShapeId } from "../canvas/types";

export interface LamportTimestamp {
  counter: number;
  peerId: string;
}

export function isNewer(a: LamportTimestamp, b: LamportTimestamp): boolean {
  if (a.counter !== b.counter) return a.counter > b.counter;
  return a.peerId > b.peerId;
}

export type CrdtOpType = "set" | "delete";

export interface CrdtOp {
  type: CrdtOpType;
  shapeId: ShapeId;
  fields?: Record<string, unknown>;
  timestamp: LamportTimestamp;
}
