import { CanvasState } from "../canvas/state.js";
import { CrdtProvider } from "./provider.js";
import type { DataChannelTransport } from "../network/data-channel-transport.js";
import type { Shape, ShapeId } from "../canvas/types.js";

export class SyncedCanvas {
  constructor(
    private readonly provider: CrdtProvider,
    private readonly state: CanvasState
  ) {
    provider.onShapeChange((shapeId, resolved) => this.syncState(shapeId, resolved));
  }

  attachTransport(transport: DataChannelTransport): void {
    this.provider.attachTransport(transport);
  }

  addShape(shape: Shape): void {
    this.provider.localSet(shape.id, shape);
  }

  updateShape(id: ShapeId, patch: Partial<Omit<Shape, "id" | "type">>): void {
    const current = this.provider.getShape(id);
    if (!current) return;
    this.provider.localSet(id, { ...current, ...patch } as Shape);
  }

  removeShape(id: ShapeId): void {
    this.provider.localDelete(id);
  }

  private syncState(id: ShapeId, resolved: Shape | undefined): void {
    if (resolved) {
      if (this.state.getShape(id)) {
        this.state.updateShape(id, resolved);
      } else {
        this.state.addShape(resolved);
      }
    } else {
      this.state.removeShape(id);
    }
  }
}
