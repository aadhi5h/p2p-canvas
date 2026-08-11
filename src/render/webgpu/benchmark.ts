import type { CanvasState } from "../../canvas/state.js";
import type { Shape } from "../../canvas/types.js";

export interface BenchmarkResult {
  shapeCount: number;
  avgFrameMs: number;
  minFrameMs: number;
  maxFrameMs: number;
  avgFps: number;
}

/**
 * Floods CanvasState with `count` synthetic shapes DIRECTLY (bypassing
 * CRDT/sync entirely — this is a local, disposable rendering
 * benchmark, not something meant to broadcast to other peers), then
 * measures real frame-to-frame timing for ~2 seconds via
 * requestAnimationFrame, then cleans up after itself.
 */
export function runRenderBenchmark(state: CanvasState, count: number, durationMs = 2000): Promise<BenchmarkResult> {
  return new Promise((resolve) => {
    const syntheticIds: string[] = [];
    const colors = ["#4f8ef7", "#f77c4f", "#4ff78e", "#f74f8e", "#f7e14f"];

    for (let i = 0; i < count; i++) {
      const id = `bench-${i}`;
      syntheticIds.push(id);
      const shape: Shape = {
        id, type: Math.random() < 0.5 ? "rect" : "circle",
        x: Math.random() * 4000 - 2000,
        y: Math.random() * 4000 - 2000,
        rotation: Math.random() * 360,
        zIndex: i,
        color: colors[i % colors.length],
        ...(Math.random() < 0.5 ? { width: 30, height: 30 } : { radius: 15 }),
      } as Shape;
      state.addShape(shape);
    }

    const frameTimes: number[] = [];
    let lastTime = performance.now();
    const startTime = lastTime;

    function tick() {
      const now = performance.now();
      frameTimes.push(now - lastTime);
      lastTime = now;

      if (now - startTime < durationMs) {
        requestAnimationFrame(tick);
      } else {
        for (const id of syntheticIds) state.removeShape(id);

        const avgFrameMs = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
        const result: BenchmarkResult = {
          shapeCount: count,
          avgFrameMs,
          minFrameMs: Math.min(...frameTimes),
          maxFrameMs: Math.max(...frameTimes),
          avgFps: 1000 / avgFrameMs,
        };
        resolve(result);
      }
    }
    requestAnimationFrame(tick);
  });
}
