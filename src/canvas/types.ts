export type ShapeId = string;

// Properties every canvas object shares, regardless of specific type.
// Structural metadata like this is what "structured canvas objects"
// means here — not just geometry, but stacking order and orientation.
interface BaseShape {
  id: ShapeId;
  x: number;
  y: number;
  rotation: number; // degrees
  zIndex: number;   // higher draws on top
}

export interface RectShape extends BaseShape {
  type: "rect";
  width: number;
  height: number;
  color: string;
}

export interface CircleShape extends BaseShape {
  type: "circle";
  radius: number;
  color: string;
}

// Adding a new variant here is the whole point of the union design
// from Day 2 — nothing downstream should need to know the full list
// of variants; it should all flow through generically.
export type Shape = RectShape | CircleShape;
