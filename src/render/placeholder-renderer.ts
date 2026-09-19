import type { CanvasState } from "../canvas/state.js";
import type { Shape } from "../canvas/types.js";
import type { Viewport } from "../canvas/viewport.js";

export function startPlaceholderRenderer(canvasEl: HTMLCanvasElement, state: CanvasState, viewport: Viewport) {
  const ctx = canvasEl.getContext("2d")!;

  function drawShape(shape: Shape): void {
    ctx.save();

    if (shape.type === "path") {
      if (shape.points.length >= 2) {
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for (let i = 1; i < shape.points.length; i++) ctx.lineTo(shape.points[i].x, shape.points[i].y);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    ctx.fillStyle = shape.color;
    if (shape.type === "rect") {
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((shape.rotation * Math.PI) / 180);
      ctx.fillRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
    } else {
      ctx.translate(shape.x, shape.y);
      ctx.rotate((shape.rotation * Math.PI) / 180);
      ctx.beginPath();
      ctx.arc(0, 0, shape.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw(): void {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.save();
    const v = viewport.get();
    ctx.scale(v.zoom, v.zoom);
    ctx.translate(-v.x, -v.y);
    const sorted = [...state.getAllShapes()].sort((a, b) => a.zIndex - b.zIndex);
    for (const shape of sorted) drawShape(shape);
    ctx.restore();
  }

  function resize() {
    canvasEl.width = window.innerWidth;
    canvasEl.height = window.innerHeight;
    draw();
  }
  window.addEventListener("resize", resize);
  resize();

  state.onChange(draw);
  viewport.onChange(draw);
}