import type { WebGPUContext } from "./device.js";
import type { CanvasState } from "../../canvas/state.js";
import type { Viewport } from "../../canvas/viewport.js";
import { createShapePipeline, buildVertexData, cullShapes } from "./shape-pipeline.js";

export function startWebGPURenderer(
  canvasEl: HTMLCanvasElement,
  gpu: WebGPUContext,
  state: CanvasState,
  viewport: Viewport
): void {
  function resize() {
    canvasEl.width = canvasEl.clientWidth;
    canvasEl.height = canvasEl.clientHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  const shapePipeline = createShapePipeline(gpu.device, gpu.format);
  let lastCullLog = 0;

  // Day 76 optimization: reuse ONE vertex buffer across frames
  // instead of allocating a fresh one every frame (Day 58-70's
  // approach). Only reallocate when the data genuinely needs more
  // space than the buffer currently has — and when we do grow, grow
  // with 50% headroom so we're not reallocating again on the very
  // next frame if the shape count keeps climbing slightly.
  let vertexBuffer: GPUBuffer | undefined;
  let vertexBufferCapacity = 0;

  function ensureVertexBuffer(byteLength: number): GPUBuffer {
    if (vertexBuffer && vertexBufferCapacity >= byteLength) {
      return vertexBuffer;
    }
    vertexBuffer?.destroy();
    vertexBufferCapacity = Math.ceil(byteLength * 1.5);
    vertexBuffer = gpu.device.createBuffer({
      size: vertexBufferCapacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    return vertexBuffer;
  }

  function frame() {
    const allShapes = state.getAllShapes();
    const v = viewport.get();
    const visibleShapes = cullShapes(allShapes, v, canvasEl.width, canvasEl.height);

    const now = performance.now();
    if (now - lastCullLog > 2000 && allShapes.length > 0) {
      lastCullLog = now;
      console.log(`[webgpu] culling: ${visibleShapes.length}/${allShapes.length} shapes visible`);
    }

    const vertexData = buildVertexData(visibleShapes);

    const encoder = gpu.device.createCommandEncoder();
    const textureView = gpu.context.getCurrentTexture().createView();

    const cameraData = new Float32Array([v.x, v.y, v.zoom, canvasEl.width, canvasEl.height, 0, 0, 0]);
    gpu.device.queue.writeBuffer(shapePipeline.cameraBuffer, 0, cameraData);

    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: textureView, clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });

    if (vertexData.length > 0) {
      const buffer = ensureVertexBuffer(vertexData.byteLength);
      gpu.device.queue.writeBuffer(buffer, 0, vertexData.buffer, vertexData.byteOffset, vertexData.byteLength);

      pass.setPipeline(shapePipeline.pipeline);
      pass.setBindGroup(0, shapePipeline.bindGroup);
      pass.setVertexBuffer(0, buffer);
      pass.draw(vertexData.length / 9);
    }

    pass.end();
    gpu.device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
