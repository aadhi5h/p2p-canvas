import { CrdtDocument } from "./document.js";
import type { CrdtOp } from "./types.js";
import type { DataChannelTransport } from "../network/data-channel-transport.js";
import type { Shape, ShapeId } from "../canvas/types.js";

type WireMessage =
  | { kind: "op"; op: CrdtOp }
  | { kind: "batch"; ops: CrdtOp[] }
  | { kind: "snapshot"; ops: CrdtOp[] };

export type ShapeChangeListener = (shapeId: ShapeId, resolved: Shape | undefined) => void;

export class CrdtProvider {
  private readonly document: CrdtDocument;
  private transports = new Set<DataChannelTransport>();
  private listeners = new Set<ShapeChangeListener>();
  private pendingOps: CrdtOp[] = [];
  private batchFlushScheduled = false;

  constructor(peerId: string) {
    this.document = new CrdtDocument(peerId);
  }

  attachTransport(transport: DataChannelTransport): void {
    this.transports.add(transport);
    transport.onMessage((raw) => this.handleMessage(raw));

    const snapshot = this.document.exportSnapshot();
    this.send(transport, { kind: "snapshot", ops: snapshot });
  }

  detachTransport(transport: DataChannelTransport): void {
    this.transports.delete(transport);
  }

  onShapeChange(listener: ShapeChangeListener): void {
    this.listeners.add(listener);
  }

  localSet(id: ShapeId, shape: Shape): void {
    const op = this.document.set(id, shape);
    this.notify(id);
    this.queueOp(op);
  }

  localUpdate(id: ShapeId, patch: Partial<Shape>): void {
    const op = this.document.update(id, patch);
    this.notify(id);
    this.queueOp(op);
  }

  localDelete(id: ShapeId): void {
    const op = this.document.delete(id);
    this.notify(id);
    this.queueOp(op);
  }

  getShape(id: ShapeId): Shape | undefined {
    return this.document.getShape(id);
  }

  getAllShapes(): Shape[] {
    return this.document.getAllShapes();
  }

  private queueOp(op: CrdtOp): void {
    this.pendingOps.push(op);
    if (!this.batchFlushScheduled) {
      this.batchFlushScheduled = true;
      queueMicrotask(() => this.flushBatch());
    }
  }

  private flushBatch(): void {
    this.batchFlushScheduled = false;
    if (this.pendingOps.length === 0) return;
    const ops = this.pendingOps;
    this.pendingOps = [];
    this.broadcast({ kind: "batch", ops });
  }

  private handleMessage(raw: string): void {
    let message: WireMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      console.warn("[crdt-provider] ignoring malformed message:", raw);
      return;
    }

    if (message.kind === "op") {
      this.document.applyOp(message.op);
      this.notify(message.op.shapeId);
    } else if (message.kind === "batch" || message.kind === "snapshot") {
      for (const op of message.ops) {
        this.document.applyOp(op);
        this.notify(op.shapeId);
      }
    }
  }

  private broadcast(message: WireMessage): void {
    for (const transport of this.transports) this.send(transport, message);
  }

  private send(transport: DataChannelTransport, message: WireMessage): void {
    transport.send(JSON.stringify(message));
  }

  private notify(shapeId: ShapeId): void {
    const resolved = this.document.getShape(shapeId);
    for (const listener of this.listeners) listener(shapeId, resolved);
  }
}