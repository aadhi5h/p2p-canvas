import type { CanvasState } from "../canvas/state.js";
import type { Shape } from "../canvas/types.js";
import type { Viewport } from "../canvas/viewport.js";

export function startPlaceholderRenderer(canvasEl: HTMLCanvasElement, state: CanvasState, viewport: Viewport) {
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
    if (shape.type === "rect") {
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((shape.rotation * Math.PI) / 180);
      ctx.fillRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
    } else if (shape.type === "circle") {
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
    ctx.save();
    const v = viewport.get();
    ctx.scale(v.zoom, v.zoom);
    ctx.translate(-v.x, -v.y);
    const sorted = [...state.getAllShapes()].sort((a, b) => a.zIndex - b.zIndex);
    for (const shape of sorted) drawShape(shape);
    ctx.restore();
  }

  state.onChange(draw);
  viewport.onChange(draw);
  draw();
}
