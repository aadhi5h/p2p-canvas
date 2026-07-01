import type { CanvasState } from "../canvas/state.js";
import type { Shape } from "../canvas/types.js";

export function startPlaceholderRenderer(canvasEl: HTMLCanvasElement, state: CanvasState) {
  const ctx = canvasEl.getContext("2d")!;

  function resize() {
    canvasEl.width = window.innerWidth;
    canvasEl.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  function drawShape(shape: Shape): void {
    ctx.save();
    ctx.fillStyle = shape.color;

    // Rotation pivots around each shape's own center — translate to
    // center, rotate, draw offset back to top-left, matches how most
    // design tools reason about object rotation.
    if (shape.type === "rect") {
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((shape.rotation * Math.PI) / 180);
      ctx.fillRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
    } else if (shape.type === "circle") {
      // Rotation is a visual no-op for a plain circle, but we still
      // apply the transform for consistency with future variants
      // (e.g. a textured or textual circle where orientation matters).
      ctx.translate(shape.x, shape.y);
      ctx.rotate((shape.rotation * Math.PI) / 180);
      ctx.beginPath();
      ctx.arc(0, 0, shape.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw(): void {
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    // Draw order follows zIndex — lower first, higher on top.
    const sorted = [...state.getAllShapes()].sort((a, b) => a.zIndex - b.zIndex);
    for (const shape of sorted) drawShape(shape);
  }

  state.onChange(draw);
  draw();
}
