import type { Shape } from "../../canvas/types.js";
import type { ViewportValue } from "../../canvas/viewport.js";

const FLOATS_PER_VERTEX = 9;
const VERTICES_PER_SHAPE = 6;

const SHADER_SOURCE = `
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
  @location(0) localUV: vec2f,
  @location(1) color: vec4f,
  @location(2) shapeType: f32,
};

@vertex
fn vs_main(
  @location(0) worldPos: vec2f,
  @location(1) localUV: vec2f,
  @location(2) color: vec4f,
  @location(3) shapeType: f32
) -> VertexOut {
  let screenX = (worldPos.x - camera.vpX) * camera.vpZoom;
  let screenY = (worldPos.y - camera.vpY) * camera.vpZoom;
  let clipX = (screenX / camera.canvasWidth) * 2.0 - 1.0;
  let clipY = 1.0 - (screenY / camera.canvasHeight) * 2.0;

  var out: VertexOut;
  out.position = vec4f(clipX, clipY, 0.0, 1.0);
  out.localUV = localUV;
  out.color = color;
  out.shapeType = shapeType;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  if (in.shapeType > 0.5) {
    if (length(in.localUV) > 1.0) {
      discard;
    }
  }
  return in.color;
}
`;

export interface ShapePipeline {
  pipeline: GPURenderPipeline;
  cameraBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
}

export function createShapePipeline(device: GPUDevice, format: GPUTextureFormat): ShapePipeline {
  const shaderModule = device.createShaderModule({ code: SHADER_SOURCE });
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
            { shaderLocation: 1, offset: 8, format: "float32x2" },
            { shaderLocation: 2, offset: 16, format: "float32x4" },
            { shaderLocation: 3, offset: 32, format: "float32" },
          ],
        },
      ],
    },
    fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  return { pipeline, cameraBuffer, bindGroup };
}

function hexToRgba(hex: string): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b, 1];
}

/** Rough world-space bounding box for any shape — good enough for a cheap AABB cull, doesn't need to be exact for rotated shapes (slightly over-includes, never under-includes). */
function boundingBox(shape: Shape): { minX: number; minY: number; maxX: number; maxY: number } {
  if (shape.type === "rect") {
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    // Use the diagonal as a radius so rotation can never push the
    // shape outside this box — conservative but cheap, no trig needed.
    const r = Math.sqrt(shape.width * shape.width + shape.height * shape.height) / 2;
    return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
  } else {
    return { minX: shape.x - shape.radius, minY: shape.y - shape.radius, maxX: shape.x + shape.radius, maxY: shape.y + shape.radius };
  }
}

/** Skips shapes whose bounding box doesn't intersect the visible world-space viewport rectangle at all. */
export function cullShapes(shapes: Shape[], viewport: ViewportValue, canvasWidth: number, canvasHeight: number): Shape[] {
  const viewMinX = viewport.x;
  const viewMinY = viewport.y;
  const viewMaxX = viewport.x + canvasWidth / viewport.zoom;
  const viewMaxY = viewport.y + canvasHeight / viewport.zoom;

  return shapes.filter((shape) => {
    const box = boundingBox(shape);
    return box.maxX >= viewMinX && box.minX <= viewMaxX && box.maxY >= viewMinY && box.minY <= viewMaxY;
  });
}

export function buildVertexData(shapes: Shape[]): Float32Array {
  const sorted = [...shapes].sort((a, b) => a.zIndex - b.zIndex);
  const data = new Float32Array(sorted.length * VERTICES_PER_SHAPE * FLOATS_PER_VERTEX);
  let offset = 0;

  for (const shape of sorted) {
    const [r, g, b, a] = hexToRgba(shape.color);
    const rot = (shape.rotation * Math.PI) / 180;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);

    let cx: number, cy: number, hw: number, hh: number, shapeType: number;
    if (shape.type === "rect") {
      cx = shape.x + shape.width / 2;
      cy = shape.y + shape.height / 2;
      hw = shape.width / 2;
      hh = shape.height / 2;
      shapeType = 0;
    } else {
      cx = shape.x;
      cy = shape.y;
      hw = shape.radius;
      hh = shape.radius;
      shapeType = 1;
    }

    const corners: Array<[number, number, number, number]> = [
      [-hw, -hh, -1, -1],
      [hw, -hh, 1, -1],
      [hw, hh, 1, 1],
      [-hw, hh, -1, 1],
    ];
    const worldCorners = corners.map(([lx, ly, u, v]) => ({
      wx: cx + (lx * cosR - ly * sinR),
      wy: cy + (lx * sinR + ly * cosR),
      u, v,
    }));

    for (const idx of [0, 1, 2, 0, 2, 3]) {
      const c = worldCorners[idx];
      data[offset++] = c.wx;
      data[offset++] = c.wy;
      data[offset++] = c.u;
      data[offset++] = c.v;
      data[offset++] = r;
      data[offset++] = g;
      data[offset++] = b;
      data[offset++] = a;
      data[offset++] = shapeType;
    }
  }

  return data;
}
