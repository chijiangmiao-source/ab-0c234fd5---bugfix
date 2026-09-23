import { describe, it, expect } from 'vitest';
import { solve } from '../src/solver';
import type { SolverInput } from '../src/types';

/**
 * 审计复核用例（来自复核页实测）：
 * 样本 0,0,1,1,-2×6；五个符号目标电平均为 0；驻留 [2,2]、D=2。
 * 旧页曾报告 E*=6、V*=4、规范补偿 (0,1,0,-1,-2)，并把每段补偿标记为唯一可达，
 * 实际全局两级最优为 E*=4、V*=2，且前两级同优方案恰有两种。
 */
const auditInput: SolverInput = {
  samples: [0, 0, 1, 1, -2, -2, -2, -2, -2, -2],
  symbols: ['A', 'B', 'C', 'D', 'E'],
  targets: [0, 0, 0, 0, 0],
  minDwell: 2,
  maxDwell: 2,
  maxShift: 2,
};

/** 按给定 ends/shifts 逐样本复算误差、逐段误差与补偿变化总量 */
function recompute(input: SolverInput, ends: number[], shifts: number[]) {
  const perSample: number[] = new Array(input.samples.length).fill(0);
  const perSegment: number[] = [];
  let start = 0;
  for (let i = 0; i < ends.length; i++) {
    let seg = 0;
    for (let x = start; x <= ends[i]; x++) {
      const e = Math.abs(input.samples[x] - (input.targets[i] + shifts[i]));
      perSample[x] = e;
      seg += e;
    }
    perSegment.push(seg);
    start = ends[i] + 1;
  }
  let variation = 0;
  for (let i = 1; i < shifts.length; i++) variation += Math.abs(shifts[i] - shifts[i - 1]);
  return {
    total: perSegment.reduce((a, b) => a + b, 0),
    perSegment,
    perSample,
    variation,
  };
}

/**
 * 独立枚举：驻留 [2,2] 下边界唯一，枚举全部 c₀=0、|cᵢ−cᵢ₋₁|≤1、cᵢ∈[-D,D] 的补偿序列。
 * 作为审计证据直接列出全部方案的 (误差, 变化量)，不依赖求解器结论。
 */
function enumeratePlans(input: SolverInput) {
  const D = input.maxShift;
  const k = input.symbols.length;
  const ends = input.symbols.map((_, i) => (i + 1) * input.minDwell - 1);
  const plans: Array<{ shifts: number[]; error: number; variation: number }> = [];
  const gen = (i: number, prev: number, seq: number[]) => {
    if (i === k) {
      const { total, variation } = recompute(input, ends, seq);
      plans.push({ shifts: [...seq], error: total, variation });
      return;
    }
    for (let c = Math.max(-D, prev - 1); c <= Math.min(D, prev + 1); c++) {
      seq.push(c);
      gen(i + 1, c, seq);
      seq.pop();
    }
  };
  gen(1, 0, [0]);
  return { ends, plans };
}

/** 补偿序列的数值字典序比较（供枚举结果稳定排序） */
function seqCompare(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}

describe('审计用例：0,0,1,1,-2×6 / 五符号零目标 / 驻留 2 / D=2', () => {
  const res = solve(auditInput);

  it('两级最优值：E*=4、V*=2', () => {
    expect(res.feasible).toBe(true);
    expect(res.bestError).toBe(4);
    expect(res.bestVariation).toBe(2);
  });

  it('规范路径：固定边界 1,3,5,7,9，补偿 0,-1,-2,-2,-2', () => {
    expect(res.ends).toEqual([1, 3, 5, 7, 9]);
    expect(res.lengths).toEqual([2, 2, 2, 2, 2]);
    expect(res.shifts).toEqual([0, -1, -2, -2, -2]);
    expect(res.canonicalVector).toEqual([1, 0, 3, -1, 5, -2, 7, -2, 9, -2]);
  });

  it('联合可达状态：首段及末两段唯一，第二、三段各有两种联合取值', () => {
    const stateSort = (a: string, b: string) => {
      const [pa, ca] = a.split('#').map(Number);
      const [pb, cb] = b.split('#').map(Number);
      return pa - pb || ca - cb;
    };
    expect(res.reachableEnds).toEqual([[1], [3], [5], [7], [9]]);
    expect(res.reachableShifts).toEqual([[0], [-1, 0], [-2, -1], [-2], [-2]]);
    expect(res.reachableStates!.map((s) => [...s].sort(stateSort))).toEqual([
      ['1#0'],
      ['3#-1', '3#0'],
      ['5#-2', '5#-1'],
      ['7#-2'],
      ['9#-2'],
    ]);
    expect(res.reachableBoundaries).toEqual([1, 3, 5, 7]);
  });

  it('逐样本/逐段误差复算与最优值闭合，变化量复算为 2', () => {
    const rec = recompute(auditInput, res.ends!, res.shifts!);
    expect(rec.perSample).toEqual([0, 0, 2, 2, 0, 0, 0, 0, 0, 0]);
    expect(rec.perSegment).toEqual([0, 4, 0, 0, 0]);
    expect(rec.total).toBe(4);
    expect(rec.total).toBe(res.bestError);
    expect(rec.variation).toBe(2);
    expect(rec.variation).toBe(res.bestVariation);
  });

  it('独立枚举：两级同优方案恰为两种，且与可达集合互为印证', () => {
    const { ends, plans } = enumeratePlans(auditInput);
    const tier1 = plans.filter((p) => p.error === 4);
    const optimal = tier1.filter((p) => p.variation === 2);
    expect(ends).toEqual([1, 3, 5, 7, 9]);
    expect(tier1).toHaveLength(2);
    expect(optimal).toHaveLength(2);
    expect(optimal.map((p) => p.shifts).sort(seqCompare)).toEqual(
      [
        [0, -1, -2, -2, -2],
        [0, 0, -1, -2, -2],
      ].sort(seqCompare),
    );

    // 枚举方案的每个状态必须落在求解器给出的联合可达集合中
    for (const p of optimal) {
      p.shifts.forEach((c, i) => {
        expect(res.reachableStates![i].has(`${ends[i]}#${c}`)).toBe(true);
      });
    }
    // 反之：每个可达状态必须至少被一条枚举同优方案经过
    for (let i = 0; i < 5; i++) {
      for (const key of res.reachableStates![i]) {
        const used = optimal.some((p) => `${ends[i]}#${p.shifts[i]}` === key);
        expect(used, `状态 ${key} 无完整同优方案经过`).toBe(true);
      }
    }
  });

  it('旧页规范路径 (0,1,0,-1,-2) 误差为 6 且其状态不可达', () => {
    const old = recompute(auditInput, [1, 3, 5, 7, 9], [0, 1, 0, -1, -2]);
    expect(old.total).toBe(6);
    expect(old.variation).toBe(4);
    for (const key of ['3#1', '5#0', '7#-1']) {
      const p = Number(key.split('#')[0]);
      const i = res.ends!.indexOf(p);
      expect(res.reachableStates![i].has(key)).toBe(false);
    }
  });
});

describe('审计用例镜像：样本整体取反（正补偿歧义集合）', () => {
  const mirrored: SolverInput = {
    ...auditInput,
    samples: auditInput.samples.map((v) => -v),
  };
  const res = solve(mirrored);

  it('同样得到 E*=4、V*=2，边界不变', () => {
    expect(res.feasible).toBe(true);
    expect(res.bestError).toBe(4);
    expect(res.bestVariation).toBe(2);
    expect(res.ends).toEqual([1, 3, 5, 7, 9]);
  });

  it('规范路径取正补偿：0,0,1,2,2（字典序最小）', () => {
    expect(res.shifts).toEqual([0, 0, 1, 2, 2]);
    expect(res.canonicalVector).toEqual([1, 0, 3, 0, 5, 1, 7, 2, 9, 2]);
  });

  it('正补偿歧义集合：第二段 {0,1}、第三段 {1,2}，其余固定', () => {
    const stateSort = (a: string, b: string) => {
      const [pa, ca] = a.split('#').map(Number);
      const [pb, cb] = b.split('#').map(Number);
      return pa - pb || ca - cb;
    };
    expect(res.reachableShifts).toEqual([[0], [0, 1], [1, 2], [2], [2]]);
    expect(res.reachableStates!.map((s) => [...s].sort(stateSort))).toEqual([
      ['1#0'],
      ['3#0', '3#1'],
      ['5#1', '5#2'],
      ['7#2'],
      ['9#2'],
    ]);
  });

  it('逐样本误差复算与枚举互证', () => {
    const rec = recompute(mirrored, res.ends!, res.shifts!);
    expect(rec.perSample).toEqual([0, 0, 1, 1, 1, 1, 0, 0, 0, 0]);
    expect(rec.perSegment).toEqual([0, 2, 2, 0, 0]);
    expect(rec.total).toBe(4);
    expect(rec.variation).toBe(2);

    const { plans } = enumeratePlans(mirrored);
    const optimal = plans.filter((p) => p.error === 4 && p.variation === 2);
    expect(optimal).toHaveLength(2);
    expect(optimal.map((p) => p.shifts).sort(seqCompare)).toEqual(
      [
        [0, 0, 1, 2, 2],
        [0, 1, 2, 2, 2],
      ].sort(seqCompare),
    );
  });
});
