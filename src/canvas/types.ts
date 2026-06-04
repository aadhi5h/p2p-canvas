// A shape is intentionally "flat" — no nested objects, no methods.
// Flat, primitive-valued records are trivial to diff, serialize,
// and merge later, which matters a lot once CRDTs enter the picture.

export type ShapeId = string;

export interface RectShape {
  id: ShapeId;
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

// Union type now, more variants (circle, path, text...) added later
// without touching existing code that only cares about "a shape".
export type Shape = RectShape;
