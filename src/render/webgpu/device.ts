export interface WebGPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

/**
 * Requests a GPU adapter + device and configures the given canvas
 * for WebGPU rendering. Returns null (rather than throwing) if
 * WebGPU isn't available - callers should fall back gracefully
 * rather than crash the whole app, since browser support still
 * varies as of 2026.
 */
export async function initWebGPU(canvasEl: HTMLCanvasElement): Promise<WebGPUContext | null> {
  if (!("gpu" in navigator)) {
    console.warn("[webgpu] navigator.gpu not available — this browser doesn't support WebGPU");
    return null;
  }

  const adapter = await (navigator as any).gpu.requestAdapter();
  if (!adapter) {
    console.warn("[webgpu] no GPU adapter found");
    return null;
  }

  const device: GPUDevice = await adapter.requestDevice();

  device.lost.then((info: any) => {
    console.error("[webgpu] device lost:", info.message, "reason:", info.reason);
  });

  const context = canvasEl.getContext("webgpu") as unknown as GPUCanvasContext;
  if (!context) {
    console.warn("[webgpu] failed to get webgpu canvas context");
    return null;
  }

  const format = (navigator as any).gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "premultiplied",
  });

  return { device, context, format };
}
