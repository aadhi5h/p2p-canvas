import type { Shape, ShapeId } from "../canvas/types.js";
import { type CrdtOp, type LamportTimestamp, isNewer } from "./types.js";

interface FieldEntry {
  value: unknown;
  timestamp: LamportTimestamp;
}

export const DELETED_FIELD = "__deleted__";

export class CrdtDocument {
  private shapes = new Map<ShapeId, Map<string, FieldEntry>>();
  private clock = 0;

  constructor(private readonly peerId: string) {}

  set(shapeId: ShapeId, shape: Shape): CrdtOp {
    const timestamp = this.tick();
    // Day 42 fix: the tombstone flag now travels WITH the broadcast
    // fields, not just applied locally. Previously, reviving a
    // deleted shape only worked on the originating peer — other
    // peers received the shape's real fields but never learned the
    // tombstone had flipped back to false, so it stayed invisible
    // for them even though the origin peer considered it alive.
    const fields: Record<string, unknown> = { ...shape, [DELETED_FIELD]: false };
    this.applyFields(shapeId, fields, timestamp);
    return { type: "set", shapeId, fields, timestamp };
  }

  delete(shapeId: ShapeId): CrdtOp {
    const timestamp = this.tick();
    this.applyFields(shapeId, { [DELETED_FIELD]: true }, timestamp);
    return { type: "delete", shapeId, timestamp };
  }

  /** Partial patch — only touches fields present in `patch`. Never touches the tombstone. */
  update(shapeId: ShapeId, patch: Partial<Shape>): CrdtOp {
    const timestamp = this.tick();
    this.applyFields(shapeId, { ...patch }, timestamp);
    return { type: "set", shapeId, fields: patch, timestamp };
  }

  applyOp(op: CrdtOp): void {
    this.observe(op.timestamp);
    if (op.type === "delete") {
      this.applyFields(op.shapeId, { [DELETED_FIELD]: true }, op.timestamp);
    } else {
      this.applyFields(op.shapeId, { ...(op.fields ?? {}) }, op.timestamp);
    }
  }

  isDeleted(shapeId: ShapeId): boolean {
    return this.shapes.get(shapeId)?.get(DELETED_FIELD)?.value === true;
  }

  getShape(shapeId: ShapeId): Shape | undefined {
    const entry = this.shapes.get(shapeId);
    if (!entry) return undefined;
    if (entry.get(DELETED_FIELD)?.value === true) return undefined;

    const result: Record<string, unknown> = {};
    for (const [field, fieldEntry] of entry) {
      if (field === DELETED_FIELD) continue;
      result[field] = fieldEntry.value;
    }
    if (!("id" in result) || !("type" in result)) return undefined;
    return result as unknown as Shape;
  }

  getAllShapes(): Shape[] {
    const result: Shape[] = [];
    for (const shapeId of this.shapes.keys()) {
      const shape = this.getShape(shapeId);
      if (shape) result.push(shape);
    }
    return result;
  }

  exportSnapshot(): CrdtOp[] {
    const ops: CrdtOp[] = [];
    for (const [shapeId, fieldMap] of this.shapes) {
      const fields: Record<string, unknown> = {};
      let latestTimestamp: LamportTimestamp | undefined;
      let isDeleted = false;

      for (const [field, entry] of fieldMap) {
        if (field === DELETED_FIELD) {
          isDeleted = entry.value === true;
          continue;
        }
        fields[field] = entry.value;
        if (!latestTimestamp || isNewer(entry.timestamp, latestTimestamp)) {
          latestTimestamp = entry.timestamp;
        }
      }
      if (!latestTimestamp) continue;

      fields[DELETED_FIELD] = isDeleted;
      ops.push({ type: "set", shapeId, fields, timestamp: latestTimestamp });
      if (isDeleted) {
        ops.push({ type: "delete", shapeId, timestamp: latestTimestamp });
      }
    }
    return ops;
  }

  private applyFields(shapeId: ShapeId, fields: Record<string, unknown>, timestamp: LamportTimestamp): void {
    let entry = this.shapes.get(shapeId);
    if (!entry) {
      entry = new Map();
      this.shapes.set(shapeId, entry);
    }
    for (const [field, value] of Object.entries(fields)) {
      const existing = entry.get(field);
      if (existing && !isNewer(timestamp, existing.timestamp)) continue;
      entry.set(field, { value, timestamp });
    }
  }

  private tick(): LamportTimestamp {
    this.clock += 1;
    return { counter: this.clock, peerId: this.peerId };
  }

  private observe(remote: LamportTimestamp): void {
    this.clock = Math.max(this.clock, remote.counter);
  }
}
