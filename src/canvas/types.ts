export type ShapeId = string;

interface BaseShape {
  id: ShapeId;
  x: number;
  y: number;
  rotation: number;
  zIndex: number;
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

export interface PathShape extends BaseShape {
  type: "path";
  points: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
}

export type Shape = RectShape | CircleShape | PathShape;