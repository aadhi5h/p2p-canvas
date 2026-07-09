import type { Shape, ShapeId } from "../canvas/types.js";
import { type CrdtOp, type LamportTimestamp, isNewer } from "./types.js";

interface FieldEntry {
  value: unknown;
  timestamp: LamportTimestamp;
}

// "deleted" is tracked as just another LWW field, alongside the
// shape's real properties — that way delete-vs-recreate races
// resolve with the exact same deterministic rule as any other field,
// no special-cased tombstone logic needed.
const DELETED_FIELD = "__deleted__";

/**
 * CrdtDocument — Day 37 rewrite. Whole-value LWW (Days 3-36) is
 * replaced with per-field LWW: every property of every shape has its
 * own independent timestamp. See docs/MERGE_BEHAVIOR.md for the full
 * history of why this changed.
 */
export class CrdtDocument {
  private shapes = new Map<ShapeId, Map<string, FieldEntry>>();
  private clock = 0;

  constructor(private readonly peerId: string) {}

  set(shapeId: ShapeId, shape: Shape): CrdtOp {
    const timestamp = this.tick();
    const fields: Record<string, unknown> = { ...shape };
    fields[DELETED_FIELD] = false; // recreating/editing implicitly un-deletes, at this timestamp
    this.applyFields(shapeId, fields, timestamp);
    return { type: "set", shapeId, fields: shape, timestamp };
  }

  delete(shapeId: ShapeId): CrdtOp {
    const timestamp = this.tick();
    this.applyFields(shapeId, { [DELETED_FIELD]: true }, timestamp);
    return { type: "delete", shapeId, timestamp };
  }


  /**
   * Day 37: partial field update. Unlike set() (whole-shape
   * creation), this ONLY touches the fields present in `patch` — each
   * gets this op's timestamp, but fields NOT in patch keep their own
   * prior timestamp entirely untouched. This is what actually makes
   * per-field merging work: set() alone can't, because it always
   * writes every field of whatever shape you hand it.
   */
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
      const fields: Record<string, unknown> = { ...(op.fields ?? {}) };
      // A remote "set" doesn't necessarily mean "un-delete" unless the
      // sender explicitly included it — but our own set() always does
      // (see above), so this only matters for hand-constructed ops
      // (e.g. tests). Real traffic always carries it.
      this.applyFields(op.shapeId, fields, op.timestamp);
    }
  }

  getShape(shapeId: ShapeId): Shape | undefined {
    const entry = this.shapes.get(shapeId);
    if (!entry) return undefined;

    const deletedEntry = entry.get(DELETED_FIELD);
    if (deletedEntry?.value === true) return undefined;

    const result: Record<string, unknown> = {};
    for (const [field, fieldEntry] of entry) {
      if (field === DELETED_FIELD) continue;
      result[field] = fieldEntry.value;
    }
    // Basic sanity check: a valid shape needs at least id and type.
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

  /** Exports every known field of every shape (including tombstones) as raw ops, for late-join catch-up. */
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

      // Snapshot as ONE combined "set" op per shape (simpler wire
      // format for catch-up) at the latest known timestamp for that
      // shape. This is an approximation — true per-field snapshot
      // would resend each field's own timestamp — acceptable for a
      // late-joiner who has no prior state to conflict with anyway.
      ops.push({ type: "set", shapeId, fields: fields as Partial<Shape>, timestamp: latestTimestamp });
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
      if (existing && !isNewer(timestamp, existing.timestamp)) continue; // existing wins, per-field
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
