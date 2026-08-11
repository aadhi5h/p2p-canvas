import type { Shape } from "../../canvas/types.js";
import type { ViewportValue } from "../../canvas/viewport.js";

const FLOATS_PER_VERTEX = 6; // worldX, worldY, idR, idG, idB, idA
const VERTICES_PER_SHAPE = 6;

const PICK_SHADER_SOURCE = `
struct Camera {
  vpX: f32,
  vpY: f32,
  vpZoom: f32,
  canvasWidth: f32,
  canvasHeight: f32,
};

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) idColor: vec4f,
};

@vertex
fn vs_main(@location(0) worldPos: vec2f, @location(1) idColor: vec4f) -> VertexOut {
  let screenX = (worldPos.x - camera.vpX) * camera.vpZoom;
  let screenY = (worldPos.y - camera.vpY) * camera.vpZoom;
  let clipX = (screenX / camera.canvasWidth) * 2.0 - 1.0;
  let clipY = 1.0 - (screenY / camera.canvasHeight) * 2.0;
  var out: VertexOut;
  out.position = vec4f(clipX, clipY, 0.0, 1.0);
  out.idColor = idColor;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return in.idColor;
}
`;

export interface PickPipeline {
  pipeline: GPURenderPipeline;
  cameraBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
}

export function createPickPipeline(device: GPUDevice): PickPipeline {
  const shaderModule = device.createShaderModule({ code: PICK_SHADER_SOURCE });
  const cameraBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
  });
  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: FLOATS_PER_VERTEX * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 8, format: "float32x4" },
          ],
        },
      ],
    },
    fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format: "rgba8unorm" }] },
    primitive: { topology: "triangle-list" },
  });
  return { pipeline, cameraBuffer, bindGroup };
}

/** Encodes each shape's index as a unique flat RGBA color, alpha=1 so we can distinguish "hit nothing" (alpha=0, cleared) from "hit shape 0". Supports up to ~16M shapes via the 3 color channels. */
function buildPickVertexData(shapesInDrawOrder: Shape[]): Float32Array {
  const data = new Float32Array(shapesInDrawOrder.length * VERTICES_PER_SHAPE * FLOATS_PER_VERTEX);
  let offset = 0;

  shapesInDrawOrder.forEach((shape, index) => {
    const idR = (index & 0xff) / 255;
    const idG = ((index >> 8) & 0xff) / 255;
    const idB = ((index >> 16) & 0xff) / 255;

    const rot = (shape.rotation * Math.PI) / 180;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);

    let cx: number, cy: number, hw: number, hh: number;
    if (shape.type === "rect") {
      cx = shape.x + shape.width / 2;
      cy = shape.y + shape.height / 2;
      hw = shape.width / 2;
      hh = shape.height / 2;
    } else {
      cx = shape.x;
      cy = shape.y;
      hw = shape.radius;
      hh = shape.radius;
      // NOTE: circles are picked via their bounding quad, not the
      // exact disc — corners of a circle's hit area are slightly
      // more generous than the visual shape. Acceptable approximation.
    }

    const corners: Array<[number, number]> = [
      [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
    ];
    const worldCorners = corners.map(([lx, ly]) => ({
      wx: cx + (lx * cosR - ly * sinR),
      wy: cy + (lx * sinR + ly * cosR),
    }));

    for (const idx of [0, 1, 2, 0, 2, 3]) {
      const c = worldCorners[idx];
      data[offset++] = c.wx;
      data[offset++] = c.wy;
      data[offset++] = idR;
      data[offset++] = idG;
      data[offset++] = idB;
      data[offset++] = 1;
    }
  });

  return data;
}

/**
 * GPU-based hit testing via color picking: renders every shape into
 * an off-screen texture using a unique ID color, then reads back just
 * the single pixel under (screenX, screenY) to determine what's
 * there. Async due to the GPU readback (mapAsync) — not used for
 * live interaction (see main.ts), available as a documented
 * capability / for benchmarking against the CPU hitTest.
 */
export async function gpuHitTest(
  device: GPUDevice,
  pick: PickPipeline,
  shapes: Shape[],
  viewport: ViewportValue,
  canvasWidth: number,
  canvasHeight: number,
  screenX: number,
  screenY: number
): Promise<Shape | undefined> {
  const sorted = [...shapes].sort((a, b) => a.zIndex - b.zIndex);
  if (sorted.length === 0) return undefined;

  const texture = device.createTexture({
    size: { width: canvasWidth, height: canvasHeight },
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  const vertexData = buildPickVertexData(sorted);
  const vertexBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
  vertexBuffer.unmap();

  const cameraData = new Float32Array([viewport.x, viewport.y, viewport.zoom, canvasWidth, canvasHeight, 0, 0, 0]);
  device.queue.writeBuffer(pick.cameraBuffer, 0, cameraData);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: texture.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
  });
  pass.setPipeline(pick.pipeline);
  pass.setBindGroup(0, pick.bindGroup);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.draw(vertexData.length / FLOATS_PER_VERTEX);
  pass.end();

  const bytesPerRow = 256; // WebGPU minimum row alignment, even though we only need 4 bytes
  const readBuffer = device.createBuffer({
    size: bytesPerRow,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  encoder.copyTextureToBuffer(
    { texture, origin: { x: Math.min(canvasWidth - 1, Math.max(0, Math.floor(screenX))), y: Math.min(canvasHeight - 1, Math.max(0, Math.floor(screenY))) } },
    { buffer: readBuffer, bytesPerRow },
    { width: 1, height: 1, depthOrArrayLayers: 1 }
  );

  device.queue.submit([encoder.finish()]);

  await readBuffer.mapAsync(GPUMapMode.READ);
  const pixel = new Uint8Array(readBuffer.getMappedRange().slice(0, 4));
  readBuffer.unmap();
  texture.destroy();

  const [r, g, b, a] = pixel;
  if (a === 0) return undefined; // cleared background — nothing hit
  const index = r | (g << 8) | (b << 16);
  return sorted[index];
}
