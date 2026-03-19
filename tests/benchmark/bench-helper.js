/**
 * Lightweight benchmark helper for Jest-based perf tests.
 *
 * Usage:
 *   const result = bench('my operation', 10000, () => { ... });
 *   // result = { name, ops, opsPerSec, avgNs, totalMs }
 */

function bench(name, iterations, fn) {
  // Warm-up: 10% of iterations or at least 10
  const warmup = Math.max(Math.min(Math.floor(iterations * 0.1), 1000), 10);
  for (let i = 0; i < warmup; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;

  const opsPerSec = (iterations / elapsed) * 1000;
  const avgNs = (elapsed / iterations) * 1e6;

  const result = {
    name,
    ops: iterations,
    opsPerSec: Math.round(opsPerSec),
    avgNs: Math.round(avgNs),
    totalMs: Math.round(elapsed * 100) / 100,
  };

  // Print a formatted line for CI/human consumption
  const opsStr = opsPerSec >= 1e6
    ? (opsPerSec / 1e6).toFixed(2) + 'M'
    : opsPerSec >= 1e3
      ? (opsPerSec / 1e3).toFixed(1) + 'K'
      : opsPerSec.toFixed(0);
  console.log(
    `  [bench] ${name.padEnd(50)} ${opsStr.padStart(10)} ops/s  (${result.totalMs}ms / ${iterations} ops)`
  );

  return result;
}

/**
 * Async benchmark — for functions that return promises.
 */
async function benchAsync(name, iterations, fn) {
  // Warm-up
  const warmup = Math.max(Math.min(Math.floor(iterations * 0.1), 100), 5);
  for (let i = 0; i < warmup; i++) await fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  const elapsed = performance.now() - start;

  const opsPerSec = (iterations / elapsed) * 1000;
  const avgNs = (elapsed / iterations) * 1e6;

  const result = {
    name,
    ops: iterations,
    opsPerSec: Math.round(opsPerSec),
    avgNs: Math.round(avgNs),
    totalMs: Math.round(elapsed * 100) / 100,
  };

  const opsStr = opsPerSec >= 1e6
    ? (opsPerSec / 1e6).toFixed(2) + 'M'
    : opsPerSec >= 1e3
      ? (opsPerSec / 1e3).toFixed(1) + 'K'
      : opsPerSec.toFixed(0);
  console.log(
    `  [bench] ${name.padEnd(50)} ${opsStr.padStart(10)} ops/s  (${result.totalMs}ms / ${iterations} ops)`
  );

  return result;
}

module.exports = { bench, benchAsync };
