import type { Shape, ShapeId } from "./types.js";

export type CanvasListener = () => void;

export class CanvasState {
  private shapes = new Map<ShapeId, Shape>();
  private listeners = new Set<CanvasListener>();

  addShape(shape: Shape): void {
    this.shapes.set(shape.id, shape);
    this.notify();
  }

  updateShape(id: ShapeId, patch: Partial<Omit<Shape, "id" | "type">>): void {
    const existing = this.shapes.get(id);
    if (!existing) return;
    this.shapes.set(id, { ...existing, ...patch });
    this.notify();
  }

  removeShape(id: ShapeId): void {
    if (this.shapes.delete(id)) this.notify();
  }

  getShape(id: ShapeId): Shape | undefined {
    return this.shapes.get(id);
  }

  getAllShapes(): Shape[] {
    return Array.from(this.shapes.values());
  }

  onChange(listener: CanvasListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
