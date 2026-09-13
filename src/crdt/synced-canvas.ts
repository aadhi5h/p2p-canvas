import { CanvasState } from "../canvas/state.js";
import { CrdtProvider } from "./provider.js";
import type { Transport } from "../network/data-channel-transport.js";
import type { Shape, ShapeId } from "../canvas/types.js";

export class SyncedCanvas {
  constructor(
    private readonly provider: CrdtProvider,
    private readonly state: CanvasState
  ) {
    provider.onShapeChange((shapeId, resolved) => this.syncState(shapeId, resolved));
  }

  attachTransport(transport: Transport): void {
    this.provider.attachTransport(transport);
  }

  addShape(shape: Shape): void {
    this.provider.localSet(shape.id, shape);
  }

  updateShape(id: ShapeId, patch: Partial<Omit<Shape, "id" | "type">>): void {
    this.provider.localUpdate(id, patch);
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