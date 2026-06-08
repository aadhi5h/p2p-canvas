import type { CanvasState } from "../canvas/state.js";

// Deliberately throwaway: a dumb Canvas2D draw loop, just for visual
// feedback that CanvasState works. Gets replaced wholesale on Day 52
// when the real WebGPU renderer shows up.
export function startPlaceholderRenderer(canvasEl: HTMLCanvasElement, state: CanvasState) {
  const ctx = canvasEl.getContext("2d")!;

  function resize() {
    canvasEl.width = window.innerWidth;
    canvasEl.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  function draw() {
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    for (const shape of state.getAllShapes()) {
      ctx.fillStyle = shape.color;
      ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
    }
  }

  state.onChange(draw);
  draw();
}
