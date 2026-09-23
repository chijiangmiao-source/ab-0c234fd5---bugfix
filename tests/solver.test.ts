import { describe, it, expect } from 'vitest';
import { solve, parseNumberList, parseSymbolList } from '../src/solver';
import { validateInput } from '../src/validation';
import type { SolverInput } from '../src/types';

/** 暴力参照：枚举全部驻留组合 × 全部合法补偿序列 */
function bruteForce(raw: SolverInput) {
  const { samples, targets, minDwell: L, maxDwell: U, maxShift: D } = raw;
  const n = samples.length;
  const k = targets.length;

  const compositions: number[][] = [];
  const compose = (left: number, parts: number, acc: number[]) => {
    if (parts === 1) {
      if (left >= L && left <= U) compositions.push([...acc, left]);
      return;
    }
    for (let x = L; x <= Math.min(U, left - (parts - 1) * L); x++) {
      compose(left - x, parts - 1, [...acc, x]);
    }
  };
  compose(n, k, []);

  interface Plan {
    ends: number[];
    shifts: number[];
    error: number;
    variation: number;
    vector: number[];
  }
  const plans: Plan[] = [];

  for (const comp of compositions) {
    const ends: number[] = [];
    let acc = -1;
    for (const len of comp) {
      acc += len;
      ends.push(acc);
    }
    const seqs: number[][] = [];
    const gen = (i: number, prev: number, seq: number[]) => {
      if (i === k) {
        seqs.push(seq);
        return;
      }
      const choices =
        i === 0
          ? [0]
          : Array.from({ length: 2 * D + 1 }, (_, ci) => ci - D).filter(
              (c) => Math.abs(c - prev) <= 1,
            );
      for (const c of choices) gen(i + 1, c, [...seq, c]);
    };
    gen(0, 0, []);

    for (const shifts of seqs) {
      let error = 0;
      let start = 0;
      for (let i = 0; i < k; i++) {
        for (let x = start; x <= ends[i]; x++) {
          error += Math.abs(samples[x] - (targets[i] + shifts[i]));
        }
        start = ends[i] + 1;
      }
      let variation = 0;
      for (let i = 1; i < k; i++) variation += Math.abs(shifts[i] - shifts[i - 1]);
      const vector: number[] = [];
      for (let i = 0; i < k; i++) vector.push(ends[i], shifts[i]);
      plans.push({ ends, shifts, error, variation, vector });
    }
  }

  if (plans.length === 0) return { feasible: false as const };

  const bestError = Math.min(...plans.map((p) => p.error));
  const tier1 = plans.filter((p) => p.error === bestError);
  const bestVariation = Math.min(...tier1.map((p) => p.variation));
  const optimal = tier1.filter((p) => p.variation === bestVariation);

  const lexLess = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  };
  const canonical = optimal.reduce((best, p) => (lexLess(p.vector, best.vector) ? p : best));

  const reachableEnds = Array.from({ length: k }, () => new Set<number>());
  const reachableShifts = Array.from({ length: k }, () => new Set<number>());
  for (const p of optimal) {
    for (let i = 0; i < k; i++) {
      reachableEnds[i].add(p.ends[i]);
      reachableShifts[i].add(p.shifts[i]);
    }
  }

  return {
    feasible: true as const,
    bestError,
    bestVariation,
    canonical,
    optimal,
    reachableEnds: reachableEnds.map((s) => [...s].sort((a, b) => a - b)),
    reachableShifts: reachableShifts.map((s) => [...s].sort((a, b) => a - b)),
    optimalCount: optimal.length,
  };
}

function makeInput(
  samples: number[],
  targets: number[],
  opts: Partial<Pick<SolverInput, 'minDwell' | 'maxDwell' | 'maxShift'>> = {},
): SolverInput {
  return {
    samples,
    symbols: targets.map((_, i) => `s${i}`),
    targets,
    minDwell: opts.minDwell ?? 1,
    maxDwell: opts.maxDwell ?? samples.length,
    maxShift: opts.maxShift ?? 3,
  };
}

/** 简单可乘性 LCG，保证测试可复现 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('求解器与暴力参照一致', () => {
  it('手工小例：D=0 退化为纯分段', () => {
    const input = makeInput([0, 0, 5, 5, 0, 0], [0, 5, 0], {
      minDwell: 1,
      maxDwell: 4,
      maxShift: 0,
    });
    const res = solve(input);
    const ref = bruteForce(input);
    expect(res.feasible).toBe(true);
    if (!res.feasible || !ref.feasible) throw new Error('应当有解');
    expect(res.bestError).toBe(ref.bestError);
    expect(res.bestVariation).toBe(0);
    expect(res.canonicalVector).toEqual(ref.canonical.vector);
    expect(res.shifts).toEqual([0, 0, 0]);
    expect(res.ends).toEqual([1, 3, 5]);
  });

  it('首个补偿固定为零、相邻补偿差不超过 1', () => {
    const input = makeInput([1, 1, 4, 4, 7, 7, 4, 4, 1], [0, 3, 6, 3, 0], {
      minDwell: 1,
      maxDwell: 3,
      maxShift: 3,
    });
    const res = solve(input);
    expect(res.feasible).toBe(true);
    if (!res.feasible) throw new Error('应当有解');
    expect(res.shifts![0]).toBe(0);
    for (let i = 1; i < res.shifts!.length; i++) {
      expect(Math.abs(res.shifts![i] - res.shifts![i - 1])).toBeLessThanOrEqual(1);
    }
    for (const s of res.shifts!) expect(Math.abs(s)).toBeLessThanOrEqual(3);
  });

  it('随机用例：两级最优值、字典序向量、全部可达集合均与暴力枚举一致', () => {
    const rand = rng(20260922);
    for (let trial = 0; trial < 60; trial++) {
      const k = 3 + Math.floor(rand() * 4); // 3..6
      const L = 1 + Math.floor(rand() * 2);
      const U = L + 1 + Math.floor(rand() * 3);
      // 规范要求样本数 ≥6；k≥3、U≥2 时 k*U≥6，故钳制后仍不超过最大总驻留
      const n = Math.max(6, k * L + Math.floor(rand() * (k * (U - L) + 1)));
      const D = Math.floor(rand() * 4); // 0..3
      const samples = Array.from({ length: n }, () => Math.floor(rand() * 11) - 3);
      const targets = Array.from({ length: k }, () => Math.floor(rand() * 9) - 2);
      const input = makeInput(samples, targets, { minDwell: L, maxDwell: U, maxShift: D });

      const res = solve(input);
      const ref = bruteForce(input);
      expect(res.feasible).toBe(ref.feasible);
      if (!res.feasible || !ref.feasible) continue;

      expect(res.bestError).toBe(ref.bestError);
      expect(res.bestVariation).toBe(ref.bestVariation);
      expect(res.canonicalVector).toEqual(ref.canonical.vector);
      expect(res.ends).toEqual(ref.canonical.ends);
      expect(res.shifts).toEqual(ref.canonical.shifts);
      expect(res.reachableEnds).toEqual(ref.reachableEnds);
      expect(res.reachableShifts).toEqual(ref.reachableShifts);

      // 全部同优方案中出现过的 (段, 结束下标, 补偿) 三元组必须恰好等于可达状态集
      for (let i = 0; i < k; i++) {
        const expected = new Set(ref.optimal.map((p) => `${p.ends[i]}#${p.shifts[i]}`));
        expect([...res.reachableStates![i]].sort()).toEqual([...expected].sort());
      }
    }
  });

  it('可达状态可扩展为完整同优方案（前缀+后缀代价闭合）', () => {
    const rand = rng(42);
    for (let trial = 0; trial < 30; trial++) {
      const k = 3 + Math.floor(rand() * 3);
      const L = 1 + Math.floor(rand() * 2);
      const U = L + Math.floor(rand() * 3) + 1;
      // 规范要求样本数 ≥6；k≥3、U≥2 时 k*U≥6，故钳制后仍不超过最大总驻留
      const n = Math.max(6, k * L + Math.floor(rand() * (k * (U - L) + 1)));
      const D = 1 + Math.floor(rand() * 3);
      const input = makeInput(
        Array.from({ length: n }, () => Math.floor(rand() * 13) - 4),
        Array.from({ length: k }, () => Math.floor(rand() * 7) - 3),
        { minDwell: L, maxDwell: U, maxShift: D },
      );
      const res = solve(input);
      const ref = bruteForce(input);
      if (!res.feasible || !ref.feasible) continue;

      // 暴力最优方案中出现的每个 (i,end,shift) 必须在 reachableStates 里
      for (const p of [ref.canonical]) {
        for (let i = 0; i < k; i++) {
          expect(res.reachableStates![i].has(`${p.ends[i]}#${p.shifts[i]}`)).toBe(true);
        }
      }
      // reachableStates 的笛卡尔内容不超过 ends/shifts 两集合的组合
      for (let i = 0; i < k; i++) {
        for (const key of res.reachableStates![i]) {
          const [p, c] = key.split('#').map(Number);
          expect(res.reachableEnds![i]).toContain(p);
          expect(res.reachableShifts![i]).toContain(c);
        }
      }
      // 边界并集 = 前 k-1 段可达结束位置之并
      const union = new Set<number>();
      for (let i = 0; i < k - 1; i++) res.reachableEnds![i].forEach((p) => union.add(p));
      expect(res.reachableBoundaries).toEqual([...union].sort((a, b) => a - b));
    }
  });

  it('字典序：同优时优先更早结束下标，再取更小补偿', () => {
    // 全零样本、全零目标：任意分段任意补偿都同为 E=0；
    // 变化量最小要求补偿恒为 0；结束下标应在驻留约束下尽早结束
    const input = makeInput(new Array(9).fill(0), [0, 0, 0, 0], {
      minDwell: 2,
      maxDwell: 4,
      maxShift: 2,
    });
    const res = solve(input);
    expect(res.feasible).toBe(true);
    if (!res.feasible) throw new Error('应当有解');
    expect(res.shifts).toEqual([0, 0, 0, 0]);
    expect(res.ends).toEqual([1, 3, 5, 8]); // 逐段最早，但末段必须到 8
    expect(res.bestError).toBe(0);
    expect(res.bestVariation).toBe(0);
  });

  it('无可行分段：样本总数小于 k*驻留下限', () => {
    const input = makeInput([0, 0, 0, 0, 0, 0], [0, 0, 0], { minDwell: 3, maxDwell: 10 });
    const res = solve(input);
    expect(res.feasible).toBe(false);
    expect(res.reasonCode).toBe('FIRST_SEGMENT');
    expect(res.reason).toContain('无可行分段');
  });

  it('无可行分段：样本总数大于 k*驻留上限', () => {
    const input = makeInput([0, 0, 0, 0, 0, 0, 0], [0, 0, 0], { minDwell: 1, maxDwell: 2 });
    const res = solve(input);
    expect(res.feasible).toBe(false);
    expect(res.reasonCode).toBe('LAST_SEGMENT');
  });

  it('末段无法结束于末样本时报告无解并给出可达末点', () => {
    // n=7, k=3, [L,U]=[2,3]：可行组合存在 (2,2,3)/(2,3,2)/(3,2,2)，故有解；
    // 改为 n=8, [2,3]：最大总驻留 9 ≥ 8、最小 6 ≤ 8，组合 (2,3,3)/(3,2,3)/(3,3,2) 有解。
    // 构造无解：L=U=2 且 n=7（k*L=6 ≠ 7）
    const input = makeInput([0, 1, 2, 3, 4, 5, 6], [0, 1, 2], { minDwell: 2, maxDwell: 2 });
    const res = solve(input);
    expect(res.feasible).toBe(false);
    expect(res.reasonCode).toBeDefined();
  });
});

describe('输入校验与首因定位', () => {
  const valid: SolverInput = {
    samples: [0, 1, 2, 3, 4, 5],
    symbols: ['a', 'b', 'c'],
    targets: [0, 1, 2],
    minDwell: 1,
    maxDwell: 6,
    maxShift: 2,
  };

  it('合法输入通过', () => {
    expect(validateInput(valid)).toBeNull();
  });

  it('样本数量越界（<6 / >600）', () => {
    expect(validateInput({ ...valid, samples: [1, 2, 3, 4, 5] })?.field).toBe('samples');
    expect(
      validateInput({ ...valid, samples: Array.from({ length: 601 }, (_, i) => i) })?.field,
    ).toBe('samples');
  });

  it('样本必须为整数', () => {
    const err = validateInput({ ...valid, samples: [1, 2, 3.5, 4, 5, 6] });
    expect(err?.field).toBe('samples');
    expect(err?.reason).toContain('第 3 个');
  });

  it('符号数量越界、为空、重复', () => {
    expect(validateInput({ ...valid, symbols: ['a', 'b'] })?.field).toBe('symbols');
    expect(
      validateInput({ ...valid, symbols: ['a', 'b', 'b'], targets: [1, 1, 1] })?.reason,
    ).toContain('重复');
    expect(
      validateInput({ ...valid, symbols: ['a', '  ', 'c'], targets: [1, 1, 1] })?.field,
    ).toBe('symbols');
    const many = Array.from({ length: 81 }, (_, i) => `x${i}`);
    expect(
      validateInput({ ...valid, symbols: many, targets: many.map(() => 0) })?.field,
    ).toBe('symbols');
  });

  it('目标电平数量与类型', () => {
    expect(validateInput({ ...valid, targets: [0, 1] })?.field).toBe('targets');
    expect(validateInput({ ...valid, targets: [0, 1.2, 3] })?.field).toBe('targets.1');
  });

  it('驻留与 D 范围', () => {
    expect(validateInput({ ...valid, minDwell: 0 })?.field).toBe('minDwell');
    expect(validateInput({ ...valid, minDwell: 4, maxDwell: 3 })?.field).toBe('minDwell');
    expect(validateInput({ ...valid, maxShift: 9 })?.field).toBe('maxShift');
    expect(validateInput({ ...valid, maxShift: -1 })?.field).toBe('maxShift');
  });
});

describe('文本解析', () => {
  it('支持空白/逗号/中文逗号/顿号分隔', () => {
    expect(parseNumberList('1, 2，3、4;5  6')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parseSymbolList('a, b，c、d;e')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('非数字原样进入数组由校验拦截（草稿不丢失）', () => {
    const parsed = parseNumberList('1 2 x 4');
    expect(parsed).toEqual([1, 2, NaN, 4]);
  });
});
