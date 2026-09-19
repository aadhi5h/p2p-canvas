import { CrdtDocument } from "./document.js";
import type { Shape } from "../canvas/types.js";

export interface StressTestResult {
  peerCount: number;
  opsPerPeer: number;
  totalOps: number;
  durationMs: number;
  opsPerSecond: number;
  allConverged: boolean;
  finalShapeCount: number;
}

function randomShape(id: string): Shape {
  const colors = ["#00C853", "#00FF55", "#7DFF00", "#DFFF00", "#FFFF00"];
  return {
    id,
    type: Math.random() < 0.5 ? "rect" : "circle",
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000,
    rotation: Math.random() * 360,
    zIndex: Math.floor(Math.random() * 100),
    color: colors[Math.floor(Math.random() * colors.length)],
    ...(Math.random() < 0.5 ? { width: 20 + Math.random() * 60, height: 20 + Math.random() * 60 } : { radius: 10 + Math.random() * 30 }),
  } as Shape;
}

export function runStressTest(peerCount: number, opsPerPeer: number): StressTestResult {
  const startTime = Date.now();
  const peers = Array.from({ length: peerCount }, (_, i) => new CrdtDocument(`stress-peer-${i}`));
  const sharedShapeIds = Array.from({ length: 20 }, (_, i) => `shared-${i}`);
  const allOps: ReturnType<CrdtDocument["set"]>[] = [];

  for (let peerIdx = 0; peerIdx < peers.length; peerIdx++) {
    const peer = peers[peerIdx];
    for (let opIdx = 0; opIdx < opsPerPeer; opIdx++) {
      const useShared = Math.random() < 0.3;
      const shapeId = useShared
        ? sharedShapeIds[Math.floor(Math.random() * sharedShapeIds.length)]
        : `peer${peerIdx}-shape${opIdx}`;

      const action = Math.random();
      if (action < 0.7) {
        allOps.push(peer.set(shapeId, randomShape(shapeId)));
      } else if (action < 0.9) {
        allOps.push(peer.update(shapeId, { color: "#FFFF00", x: Math.random() * 100 }));
      } else {
        allOps.push(peer.delete(shapeId));
      }
    }
  }

  for (const peer of peers) {
    const shuffled = [...allOps].sort(() => Math.random() - 0.5);
    for (const op of shuffled) peer.applyOp(op);
  }

  const durationMs = Date.now() - startTime;
  const totalOps = peerCount * opsPerPeer;

    function stableStringify(shape: Shape): string {
    return JSON.stringify(shape, Object.keys(shape).sort());
  }
  function canonicalState(p: CrdtDocument): string {
    return p.getAllShapes()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(stableStringify)
      .join("|");
  }

  const referenceState = canonicalState(peers[0]);
  const allConverged = peers.every((p) => canonicalState(p) === referenceState);

  return {
    peerCount,
    opsPerPeer,
    totalOps,
    durationMs,
    opsPerSecond: totalOps / (durationMs / 1000),
    allConverged,
    finalShapeCount: peers[0].getAllShapes().length,
  };
}