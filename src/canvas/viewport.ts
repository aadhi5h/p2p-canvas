export interface ViewportValue {
  x: number;    // world-space coordinate visible at the screen's top-left
  y: number;
  zoom: number; // 1 = 100%
}

export type ViewportListener = () => void;

/**
 * The local camera: which part of the infinite canvas is visible,
 * and at what zoom. Shapes always store WORLD coordinates — this
 * class is the only place that converts world <-> screen space.
 */
export class Viewport {
  private state: ViewportValue = { x: 0, y: 0, zoom: 1 };
  private listeners = new Set<ViewportListener>();

  get(): ViewportValue {
    return { ...this.state };
  }

  onChange(listener: ViewportListener): void {
    this.listeners.add(listener);
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.state = {
      ...this.state,
      x: this.state.x - dxScreen / this.state.zoom,
      y: this.state.y - dyScreen / this.state.zoom,
    };
    this.notify();
  }

  /** Zoom in/out while keeping the world point under (screenX, screenY) visually fixed. */
  zoomAt(factor: number, screenX: number, screenY: number): void {
    const before = this.screenToWorld(screenX, screenY);
    const newZoom = Math.min(8, Math.max(0.1, this.state.zoom * factor));
    this.state = { ...this.state, zoom: newZoom };
    const after = this.screenToWorld(screenX, screenY);
    this.state = {
      ...this.state,
      x: this.state.x + (before.x - after.x),
      y: this.state.y + (before.y - after.y),
    };
    this.notify();
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return { x: this.state.x + screenX / this.state.zoom, y: this.state.y + screenY / this.state.zoom };
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return { x: (worldX - this.state.x) * this.state.zoom, y: (worldY - this.state.y) * this.state.zoom };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
