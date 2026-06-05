import type { Shape, ShapeId } from "../canvas/types";
import { type CrdtOp, type LamportTimestamp, isNewer } from "./types";

interface Entry {
  value: Shape | null; // null means "deleted, but we remember it happened"
  timestamp: LamportTimestamp;
}

/**
 * CrdtDocument is a Last-Writer-Wins Map keyed by shape id.
 *
 * It knows NOTHING about the network or rendering — same separation
 * principle as CanvasState. On Day 8+, this becomes the thing that
 * both produces ops (from local edits) and consumes ops (from remote
 * peers), and CanvasState becomes a pure "view" of whatever this
 * document currently resolves to.
 */
export class CrdtDocument {
  private entries = new Map<ShapeId, Entry>();
  private clock = 0;

  constructor(private readonly peerId: string) {}

  /** Called for a LOCAL edit. Produces an op to broadcast later. */
  set(shapeId: ShapeId, value: Shape): CrdtOp {
    const timestamp = this.tick();
    this.entries.set(shapeId, { value, timestamp });
    return { type: "set", shapeId, value, timestamp };
  }

  /** Called for a LOCAL delete. Produces an op to broadcast later. */
  delete(shapeId: ShapeId): CrdtOp {
    const timestamp = this.tick();
    this.entries.set(shapeId, { value: null, timestamp });
    return { type: "delete", shapeId, value: null, timestamp };
  }

  /**
   * Called for a REMOTE op (ours or another peer's, replayed).
   * This is the actual conflict resolution: only apply if the
   * incoming timestamp is newer than what we already have.
   */
  applyOp(op: CrdtOp): void {
    const existing = this.entries.get(op.shapeId);
    if (existing && !isNewer(op.timestamp, existing.timestamp)) {
      return; // we already have something newer or equal — ignore
    }
    this.entries.set(op.shapeId, { value: op.value, timestamp: op.timestamp });
    this.observe(op.timestamp);
  }

  getShape(shapeId: ShapeId): Shape | undefined {
    return this.entries.get(shapeId)?.value ?? undefined;
  }

  getAllShapes(): Shape[] {
    const result: Shape[] = [];
    for (const entry of this.entries.values()) {
      if (entry.value !== null) result.push(entry.value);
    }
    return result;
  }

  /** Local clock tick: always advances past anything we've seen. */
  private tick(): LamportTimestamp {
    this.clock += 1;
    return { counter: this.clock, peerId: this.peerId };
  }

  /** When we see a remote timestamp, fast-forward our clock past it. */
  private observe(remote: LamportTimestamp): void {
    this.clock = Math.max(this.clock, remote.counter);
  }
}
