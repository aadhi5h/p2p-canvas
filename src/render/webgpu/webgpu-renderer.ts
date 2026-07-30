import type { WebGPUContext } from "./device.js";
import type { CanvasState } from "../../canvas/state.js";
import type { Viewport } from "../../canvas/viewport.js";
import { createShapePipeline, buildVertexData } from "./shape-pipeline.js";

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

  function frame() {
    const shapes = state.getAllShapes();
    const vertexData = buildVertexData(shapes);

    const encoder = gpu.device.createCommandEncoder();
    const textureView = gpu.context.getCurrentTexture().createView();

    const v = viewport.get();
    const cameraData = new Float32Array([v.x, v.y, v.zoom, canvasEl.width, canvasEl.height, 0, 0, 0]);
    gpu.device.queue.writeBuffer(shapePipeline.cameraBuffer, 0, cameraData);

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

    if (vertexData.length > 0) {
      // Recreated every frame for simplicity — correct but not
      // optimal. Buffer reuse/pooling is addressed in the later
      // GPU buffer optimization pass (Day 76 in our plan).
      const vertexBuffer = gpu.device.createBuffer({
        size: vertexData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
      vertexBuffer.unmap();

      pass.setPipeline(shapePipeline.pipeline);
      pass.setBindGroup(0, shapePipeline.bindGroup);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.draw(vertexData.length / 9);
    }

    pass.end();
    gpu.device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
