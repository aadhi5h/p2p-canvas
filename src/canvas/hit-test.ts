import type { Shape } from "./types.js";

function pointInShape(px: number, py: number, shape: Shape): boolean {
  if (shape.type === "rect") {
    return px >= shape.x && px <= shape.x + shape.width && py >= shape.y && py <= shape.y + shape.height;
  } else {
    const dx = px - shape.x;
    const dy = py - shape.y;
    return Math.sqrt(dx * dx + dy * dy) <= shape.radius;
  }
}

/** Returns the TOPMOST shape (highest zIndex) under the given point, or undefined. */
export function hitTest(shapes: Shape[], px: number, py: number): Shape | undefined {
  const candidates = shapes.filter((s) => pointInShape(px, py, s));
  if (candidates.length === 0) return undefined;
  return candidates.reduce((top, s) => (s.zIndex > top.zIndex ? s : top));
}
