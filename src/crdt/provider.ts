import { CrdtDocument } from "./document.js";
import type { CrdtOp } from "./types.js";
import type { DataChannelTransport } from "../network/data-channel-transport.js";
import type { Shape, ShapeId } from "../canvas/types.js";

type WireMessage =
  | { kind: "op"; op: CrdtOp }
  | { kind: "snapshot"; ops: CrdtOp[] };

export type ShapeChangeListener = (shapeId: ShapeId, resolved: Shape | undefined) => void;

/**
 * Wraps a raw CrdtDocument and owns everything about staying in
 * sync over the wire:
 *  - broadcasting local edits as ops, to every attached peer
 *  - applying remote ops through conflict resolution
 *  - sending a FULL SNAPSHOT to any newly attached peer, since a
 *    late joiner has seen none of the prior ops (the gap from Day 8)
 *  - notifying listeners whenever a shape's resolved value changes,
 *    whether the change came from a local edit, a live remote op,
 *    or a catch-up snapshot
 */
export class CrdtProvider {
  private readonly document: CrdtDocument;
  private transports = new Set<DataChannelTransport>();
  private listeners = new Set<ShapeChangeListener>();

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
    this.broadcast({ kind: "op", op });
  }

  localDelete(id: ShapeId): void {
    const op = this.document.delete(id);
    this.notify(id);
    this.broadcast({ kind: "op", op });
  }

  getShape(id: ShapeId): Shape | undefined {
    return this.document.getShape(id);
  }

  getAllShapes(): Shape[] {
    return this.document.getAllShapes();
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
    } else if (message.kind === "snapshot") {
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
