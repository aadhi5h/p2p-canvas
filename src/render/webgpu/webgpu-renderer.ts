import type { WebGPUContext } from "./device.js";

/**
 * scope: prove the device/context/render-loop pipeline works
 * end to end. Just clears to a color each frame - no vertex buffers,
 * no shapes yet. This IS a real GPU render pass,
 * though, not a placeholder - it proves requestAnimationFrame,
 * command encoding, and presentation all function correctly.
 */
export function startWebGPURenderer(canvasEl: HTMLCanvasElement, gpu: WebGPUContext): void {
  function resize() {
    canvasEl.width = canvasEl.clientWidth;
    canvasEl.height = canvasEl.clientHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  function frame() {
    const encoder = gpu.device.createCommandEncoder();
    const textureView = gpu.context.getCurrentTexture().createView();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.end();

    gpu.device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
