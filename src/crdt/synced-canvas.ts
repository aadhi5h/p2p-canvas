import { CanvasState } from "../canvas/state.js";
import { CrdtDocument } from "./document.js";
import type { CrdtOp } from "./types.js";
import type { DataChannelTransport } from "../network/data-channel-transport.js";
import type { Shape, ShapeId } from "../canvas/types.js";

/**
 * Bridges CrdtDocument (the source of truth) and CanvasState (what
 * gets rendered), and broadcasts/receives ops over a transport.
 *
 * Rule of thumb this class enforces: CanvasState NEVER gets written
 * to directly from an op. It always gets synced FROM whatever
 * CrdtDocument currently resolves to, after the op has gone through
 * conflict resolution. That's true for local edits too — it's the
 * same code path either way, which is what makes "local" and
 * "remote" edits behave identically.
 */
export class SyncedCanvas {
  private transport: DataChannelTransport | undefined;

  constructor(
    private readonly document: CrdtDocument,
    private readonly state: CanvasState
  ) {}

  attachTransport(transport: DataChannelTransport): void {
    this.transport = transport;
    transport.onMessage((raw) => this.handleRemoteMessage(raw));
  }

  addShape(shape: Shape): void {
    const op = this.document.set(shape.id, shape);
    this.syncStateForShape(op.shapeId);
    this.broadcast(op);
  }

  updateShape(id: ShapeId, patch: Partial<Omit<Shape, "id" | "type">>): void {
    const current = this.document.getShape(id);
    if (!current) return;
    const updated = { ...current, ...patch } as Shape;
    const op = this.document.set(id, updated);
    this.syncStateForShape(op.shapeId);
    this.broadcast(op);
  }

  removeShape(id: ShapeId): void {
    const op = this.document.delete(id);
    this.syncStateForShape(op.shapeId);
    this.broadcast(op);
  }

  private handleRemoteMessage(raw: string): void {
    let op: CrdtOp;
    try {
      op = JSON.parse(raw);
    } catch {
      console.warn("[sync] ignoring malformed message:", raw);
      return;
    }
    this.document.applyOp(op); // conflict resolution happens here
    this.syncStateForShape(op.shapeId); // canvas reflects whatever WON, not necessarily this op
  }

  private broadcast(op: CrdtOp): void {
    this.transport?.send(JSON.stringify(op));
  }

  /** Pulls CanvasState back into agreement with what the CRDT resolves to. */
  private syncStateForShape(id: ShapeId): void {
    const resolved = this.document.getShape(id);
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
