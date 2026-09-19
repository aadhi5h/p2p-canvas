/// <reference types="node" />
import { runStressTest } from "./stress-test.js";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

console.log("Stress test: 10 peers, 500 ops each, heavy overlap on shared shapes");
{
  const result = runStressTest(10, 500);
  console.log(`  ${result.totalOps} total ops in ${result.durationMs}ms (${result.opsPerSecond.toFixed(0)} ops/sec)`);
  console.log(`  final shape count: ${result.finalShapeCount}`);
  assert(result.allConverged, "all 10 peers converge to an identical final state despite random apply order");
  assert(result.opsPerSecond > 1000, "throughput exceeds 1000 ops/sec (sanity floor, not a hard perf target)");
}

console.log("\nStress test: 25 peers, 200 ops each");
{
  const result = runStressTest(25, 200);
  console.log(`  ${result.totalOps} total ops in ${result.durationMs}ms (${result.opsPerSecond.toFixed(0)} ops/sec)`);
  assert(result.allConverged, "all 25 peers converge despite heavier concurrency");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);