import { it, expect } from 'vitest';
import { solve } from '../src/solver';

it('最大规模 n=600,k=80,D=8 可快速求解且结果自洽', () => {
  const n = 600;
  const k = 80;
  let s = 12345;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const targets = Array.from({ length: k }, (_, i) => Math.floor(rnd() * 40) - 20 + (i % 5) * 3);
  const samples = Array.from({ length: n }, (_, x) => {
    const seg = Math.min(k - 1, Math.floor((x / n) * k));
    return targets[seg] + Math.floor(rnd() * 5) - 2;
  });
  const t0 = performance.now();
  const res = solve({
    samples,
    symbols: targets.map((_, i) => `S${i}`),
    targets,
    minDwell: 1,
    maxDwell: 600,
    maxShift: 8,
  });
  const ms = performance.now() - t0;
  expect(res.feasible).toBe(true);
  if (!res.feasible) return;
  expect(ms).toBeLessThan(3000);

  // 自洽性检查
  expect(res.ends![res.k - 1]).toBe(n - 1);
  expect(res.shifts![0]).toBe(0);
  let totalLen = 0;
  let recomputeError = 0;
  for (let i = 0; i < k; i++) {
    totalLen += res.lengths![i];
    const start = i === 0 ? 0 : res.ends![i - 1] + 1;
    for (let x = start; x <= res.ends![i]; x++) {
      recomputeError += Math.abs(samples[x] - (targets[i] + res.shifts![i]));
    }
    if (i > 0) expect(Math.abs(res.shifts![i] - res.shifts![i - 1])).toBeLessThanOrEqual(1);
    for (const c of res.reachableShifts![i]) expect(Math.abs(c)).toBeLessThanOrEqual(8);
  }
  expect(totalLen).toBe(n);
  expect(recomputeError).toBe(res.bestError);
  expect(res.canonicalVector!.length).toBe(2 * k);
});
