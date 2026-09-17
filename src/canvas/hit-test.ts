import type { Shape } from "./types.js";

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function pointInShape(px: number, py: number, shape: Shape): boolean {
  if (shape.type === "rect") {
    return px >= shape.x && px <= shape.x + shape.width && py >= shape.y && py <= shape.y + shape.height;
  } else if (shape.type === "circle") {
    const dx = px - shape.x;
    const dy = py - shape.y;
    return Math.sqrt(dx * dx + dy * dy) <= shape.radius;
  } else if (shape.type === "path") {
    const threshold = shape.strokeWidth / 2 + 6;
    for (let i = 0; i < shape.points.length - 1; i++) {
      const a = shape.points[i];
      const b = shape.points[i + 1];
      if (distToSegment(px, py, a.x, a.y, b.x, b.y) <= threshold) return true;
    }
    return false;
  }
  return false;
}

export function hitTest(shapes: Shape[], px: number, py: number): Shape | undefined {
  const candidates = shapes.filter((s) => pointInShape(px, py, s));
  if (candidates.length === 0) return undefined;
  return candidates.reduce((top, s) => (s.zIndex > top.zIndex ? s : top));
}