import type { Shape, ShapeId } from "../canvas/types";

export interface LamportTimestamp {
  counter: number;
  peerId: string;
}

export function isNewer(a: LamportTimestamp, b: LamportTimestamp): boolean {
  if (a.counter !== b.counter) return a.counter > b.counter;
  return a.peerId > b.peerId;
}

export type CrdtOpType = "set" | "delete";

/**
 * Day 37 change: "set" ops now carry a partial field bag, not a full
 * Shape. Every field in `fields` shares this op's single timestamp
 * (one local edit = one atomic timestamp across whatever fields it
 * touched), but different ops on different fields resolve
 * INDEPENDENTLY against each other — that's what fixes the Day 18/33
 * data-loss problem.
 */
export interface CrdtOp {
  type: CrdtOpType;
  shapeId: ShapeId;
  fields?: Partial<Shape>; // present for "set"; absent/ignored for "delete"
  timestamp: LamportTimestamp;
}
