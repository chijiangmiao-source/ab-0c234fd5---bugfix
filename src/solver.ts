import type { SolverInput, SolveResult, StateKey } from './types';
import { validateInput } from './validation';

/** 滑动窗口内按 (误差, 变化量) 字典序维护最小值的单调双端队列 */
class MonotonicQueue {
  private q: number[] = [];
  private ke: number[] = [];
  private kv: number[] = [];
  private head = 0;

  push(pos: number, errorKey: number, variationKey: number): void {
    while (this.q.length > this.head) {
      const j = this.q.length - 1;
      const e = this.ke[j];
      const v = this.kv[j];
      // 键值相同或更差的旧条目直接淘汰：新条目位置更有利、到期更晚
      if (e < errorKey || (e === errorKey && v < variationKey)) break;
      this.q.pop();
      this.ke.pop();
      this.kv.pop();
    }
    this.q.push(pos);
    this.ke.push(errorKey);
    this.kv.push(variationKey);
  }

  /** 移除所有 pos < minPos 的队首条目 */
  evictBefore(minPos: number): void {
    while (this.head < this.q.length && this.q[this.head] < minPos) this.head++;
  }

  /** 移除所有 pos > maxPos 的队首条目（反向扫描时使用） */
  evictAfter(maxPos: number): void {
    while (this.head < this.q.length && this.q[this.head] > maxPos) this.head++;
  }

  get empty(): boolean {
    return this.head === this.q.length;
  }

  get frontError(): number {
    return this.ke[this.head];
  }

  get frontVariation(): number {
    return this.kv[this.head];
  }
}

interface Layer {
  /** 状态代价，index = p * m + ci；Infinity 表示不可达 */
  error: Float64Array;
  /** 变化量，-1 表示不可达 */
  variation: Int32Array;
}

interface PrefixLayer {
  error: Float64Array;
  variation: Int32Array;
  shift: Int16Array;
}

export function solve(raw: SolverInput): SolveResult {
  const validationError = validateInput(raw);
  const base: SolveResult = {
    feasible: false,
    n: Array.isArray(raw.samples) ? raw.samples.length : 0,
    k: Array.isArray(raw.symbols) ? raw.symbols.length : 0,
    minDwell: raw.minDwell,
    maxDwell: raw.maxDwell,
    maxShift: raw.maxShift,
  };
  if (validationError) {
    return { ...base, reason: validationError.reason, reasonCode: 'NO_PARTITION' };
  }

  const { samples, symbols, targets, minDwell: L, maxDwell: U, maxShift: D } = raw;
  const n = samples.length;
  const k = symbols.length;
  const m = 2 * D + 1;
  const ciOf = (c: number) => c + D;
  const shiftOf = (ci: number) => ci - D;
  const idx = (p: number, ci: number) => p * m + ci;
  const stateKey = (p: number, c: number): StateKey => `${p}#${c}`;

  // 结构性必要条件：k 段驻留总量必须容得下 n
  if (n < k * L) {
    return {
      ...base,
      feasible: false,
      reasonCode: 'FIRST_SEGMENT',
      reason: `无可行分段：${k} 段每段至少驻留 ${L} 个样本，共需至少 ${k * L} 个，当前只有 ${n} 个样本。`,
    };
  }
  if (n > k * U) {
    return {
      ...base,
      feasible: false,
      reasonCode: 'LAST_SEGMENT',
      reason: `无可行分段：${k} 段每段至多驻留 ${U} 个样本，总共最多覆盖 ${k * U} 个，当前有 ${n} 个样本（最后一段无法在末样本处结束）。`,
    };
  }

  // 每段、每个补偿的绝对误差前缀和：P[seg][ci][r] = Σ_{x<r}|samples[x]-(targets[seg]+c)|
  const P: Float64Array[][] = [];
  for (let i = 0; i < k; i++) {
    const rows: Float64Array[] = [];
    for (let ci = 0; ci < m; ci++) {
      const level = targets[i] + shiftOf(ci);
      const arr = new Float64Array(n + 1);
      let acc = 0;
      for (let x = 0; x < n; x++) {
        acc += Math.abs(samples[x] - level);
        arr[x + 1] = acc;
      }
      rows.push(arr);
    }
    P.push(rows);
  }
  /** 段 i 在补偿 c 下覆盖样本 [start, end] 的误差 */
  const segCost = (i: number, ci: number, start: number, end: number) =>
    P[i][ci][end + 1] - P[i][ci][start];

  const newLayer = (): Layer => ({
    error: new Float64Array(n * m).fill(Infinity),
    variation: new Int32Array(n * m).fill(-1),
  });

  const newPrefixLayer = (): PrefixLayer => ({
    error: new Float64Array(n).fill(Infinity),
    variation: new Int32Array(n).fill(-1),
    shift: new Int16Array(n).fill(D + 1),
  });

  // ---------- 前向 DP：F[i][p][c] ----------
  const forward: PrefixLayer[] = [];
  {
    const layer = newPrefixLayer();
    const ci0 = ciOf(0);
    const lastP = Math.min(U - 1, n - 1);
    for (let p = L - 1; p <= lastP; p++) {
      layer.error[p] = segCost(0, ci0, 0, p);
      layer.variation[p] = 0;
      layer.shift[p] = 0;
    }
    forward.push(layer);
  }

  for (let i = 1; i < k; i++) {
    const prev = forward[i - 1];
    const cur = newPrefixLayer();
    let layerReachable = false;

    for (let ci = 0; ci < m; ci++) {
      const c = shiftOf(ci);
      // 三个合法前驱补偿各维护一个滑动窗口最小值队列
      const queues = new Map<number, MonotonicQueue>();
      for (const cj of [ci - 1, ci, ci + 1]) {
        if (cj >= 0 && cj < m) queues.set(cj, new MonotonicQueue());
      }

      for (let p = 0; p < n; p++) {
        const qAdd = p - L; // 本轮新进入窗口的前驱结束位置
        if (qAdd >= 0) {
          for (const [cj, dq] of queues) {
            if (prev.shift[qAdd] === shiftOf(cj) && Number.isFinite(prev.error[qAdd])) {
              dq.push(
                qAdd,
                prev.error[qAdd] - P[i][ci][qAdd + 1],
                prev.variation[qAdd],
              );
            }
          }
        }
        const qMin = p - U;
        for (const [cj, dq] of queues) {
          dq.evictBefore(qMin);
          if (dq.empty) continue;
          const candE = dq.frontError + P[i][ci][p + 1];
          const candV = dq.frontVariation + Math.abs(c - shiftOf(cj));
          if (
            candE < cur.error[p] ||
            (candE === cur.error[p] &&
              (candV < cur.variation[p] ||
                (candV === cur.variation[p] && c < cur.shift[p])))
          ) {
            cur.error[p] = candE;
            cur.variation[p] = candV;
            cur.shift[p] = c;
            layerReachable = true;
          }
        }
      }
    }

    if (!layerReachable) {
      const code = i === k - 1 ? 'LAST_SEGMENT' : i === 0 ? 'FIRST_SEGMENT' : 'MIDDLE_SEGMENT';
      return {
        ...base,
        reasonCode: code,
        reason:
          `第 ${i + 1} 段（符号「${symbols[i]}」）在驻留区间 [${L}, ${U}] 内找不到任何可行位置：` +
          `前面所有段的结束位置都无法以合法驻留长度接上该段（误差与补偿尚无自由度可消除此矛盾）。`,
      };
    }
    forward.push(cur);
  }

  // ---------- 全局两级最优（末段必须结束于 n-1） ----------
  const bestError = forward[k - 1].error[n - 1];
  const bestVariation = forward[k - 1].variation[n - 1];
  if (!Number.isFinite(bestError)) {
    const reachableEnds: number[] = [];
    const last = forward[k - 1];
    for (let p = 0; p < n; p++) {
      if (Number.isFinite(last.error[p])) reachableEnds.push(p);
    }
    return {
      ...base,
      reasonCode: 'LAST_SEGMENT',
      reason:
        `无解：最后一段（符号「${symbols[k - 1]}」）无法在最后一个样本（下标 ${n - 1}）处结束。` +
        (reachableEnds.length > 0
          ? `末段可达的结束下标仅为 ${reachableEnds.join(', ')}，均不是末点。`
          : '不存在任何可覆盖全部样本的分段。'),
    };
  }

  // ---------- 反向 DP：B[i][p][c]，状态 (i,p,c) 之后铺完剩余段的最优对 ----------
  const backward: Layer[] = new Array(k);
  {
    const last = newLayer();
    for (let ci = 0; ci < m; ci++) {
      last.error[idx(n - 1, ci)] = 0;
      last.variation[idx(n - 1, ci)] = 0;
    }
    backward[k - 1] = last;
  }
  for (let i = k - 2; i >= 0; i--) {
    const next = backward[i + 1];
    const cur = newLayer();

    for (let ci = 0; ci < m; ci++) {
      const c = shiftOf(ci);
      const queues = new Map<number, MonotonicQueue>();
      for (const cj of [ci - 1, ci, ci + 1]) {
        if (cj >= 0 && cj < m) queues.set(cj, new MonotonicQueue());
      }

      for (let p = n - 1; p >= 0; p--) {
        const qAdd = p + L; // 反向扫描：新进入窗口的下一段结束位置
        if (qAdd <= n - 1) {
          for (const [cj, dq] of queues) {
            const pi = idx(qAdd, cj);
            if (Number.isFinite(next.error[pi])) {
              dq.push(
                qAdd,
                next.error[pi] + P[i + 1][cj][qAdd + 1],
                next.variation[pi],
              );
            }
          }
        }
        const qMax = p + U;
        for (const [cj, dq] of queues) {
          dq.evictAfter(qMax);
          if (dq.empty) continue;
          const candE = dq.frontError - P[i + 1][cj][p + 1];
          const candV = dq.frontVariation + Math.abs(shiftOf(cj) - c);
          const oi = idx(p, ci);
          if (candE < cur.error[oi] || (candE === cur.error[oi] && candV < cur.variation[oi])) {
            cur.error[oi] = candE;
            cur.variation[oi] = candV;
          }
        }
      }
    }
    backward[i] = cur;
  }

  // ---------- 全部两级同优方案的完整可达集合 ----------
  const reachableStates: Array<Set<StateKey>> = [];
  const reachableEnds: number[][] = [];
  const reachableShifts: number[][] = [];
  const boundaryUnion = new Set<number>();

  const onOptimal = (e: number, v: number) => e === bestError && v === bestVariation;

  for (let i = 0; i < k; i++) {
    const states = new Set<StateKey>();
    const ends = new Set<number>();
    const shifts = new Set<number>();
    for (let p = 0; p < n; p++) {
      for (let ci = 0; ci < m; ci++) {
        if (forward[i].shift[p] !== shiftOf(ci)) continue;
        const fe = forward[i].error[p];
        if (!Number.isFinite(fe)) continue;
        const be = backward[i].error[idx(p, ci)];
        if (!Number.isFinite(be)) continue;
        if (onOptimal(fe + be, forward[i].variation[p] + backward[i].variation[idx(p, ci)])) {
          const c = shiftOf(ci);
          states.add(stateKey(p, c));
          ends.add(p);
          shifts.add(c);
          if (i < k - 1) boundaryUnion.add(p);
        }
      }
    }
    reachableStates.push(states);
    reachableEnds.push([...ends].sort((a, b) => a - b));
    reachableShifts.push([...shifts].sort((a, b) => a - b));
  }

  // ---------- 字典序最小规范路径：交错向量 [end0,c0,end1,c1,...) ----------
  const ends: number[] = [];
  const shifts: number[] = [];
  const lengths: number[] = [];
  let preError = 0;
  let preVariation = 0;
  let prevEnd = -1;
  let prevCi = -1;

  for (let i = 0; i < k; i++) {
    let chosenP = -1;
    let chosenCi = -1;
    const ciCandidates: number[] = [];
    if (i === 0) ciCandidates.push(ciOf(0)); // 首个补偿固定为零
    else {
      for (let ci = 0; ci < m; ci++) {
        if (Math.abs(shiftOf(ci) - shiftOf(prevCi)) <= 1) ciCandidates.push(ci);
      }
    }

    for (let p = 0; p < n && chosenP < 0; p++) {
      // 交错顺序：先选最小 end，再在该 end 下选最小补偿
      let bestCi = -1;
      for (const ci of ciCandidates) {
        if (!reachableStates[i].has(stateKey(p, shiftOf(ci)))) continue;
        const dwell = p - prevEnd;
        if (dwell < L || dwell > U) continue;
        if (i > 0 && Math.abs(shiftOf(ci) - shiftOf(prevCi)) > 1) continue;
        const addE = segCost(i, ci, prevEnd + 1, p);
        const addV = i === 0 ? 0 : Math.abs(shiftOf(ci) - shiftOf(prevCi));
        const pe = preError + addE;
        const pv = preVariation + addV;
        const be = backward[i].error[idx(p, ci)];
        const bv = backward[i].variation[idx(p, ci)];
        if (pe + be === bestError && pv + bv === bestVariation) {
          bestCi = ci; // ci 按补偿升序遍历，首个即最小补偿
          break;
        }
      }
      if (bestCi >= 0) {
        chosenP = p;
        chosenCi = bestCi;
      }
    }

    if (chosenP < 0) {
      // 理论上不可达：可达集合非空时前缀贪心必能续接
      return {
        ...base,
        reasonCode: 'NO_PARTITION',
        reason: `内部错误：第 ${i + 1} 段无法从规范前缀续接（请提交复现用例）。`,
      };
    }

    ends.push(chosenP);
    shifts.push(shiftOf(chosenCi));
    lengths.push(chosenP - prevEnd);
    preError += segCost(i, chosenCi, prevEnd + 1, chosenP);
    preVariation += i === 0 ? 0 : Math.abs(shiftOf(chosenCi) - shiftOf(prevCi));
    prevEnd = chosenP;
    prevCi = chosenCi;
  }

  const canonicalVector: number[] = [];
  for (let i = 0; i < k; i++) canonicalVector.push(ends[i], shifts[i]);

  return {
    ...base,
    feasible: true,
    bestError,
    bestVariation,
    lengths,
    ends,
    shifts,
    canonicalVector,
    reachableEnds,
    reachableShifts,
    reachableStates,
    reachableBoundaries: [...boundaryUnion].sort((a, b) => a - b),
  };
}

/** 解析文本录入：支持空白、逗号、分号、中文逗号分隔 */
export function parseNumberList(text: string): number[] {
  return text
    .split(/[\s,;，、]+/)
    .filter((t) => t.length > 0)
    .map((t) => Number(t));
}

/** 解析符号录入 */
export function parseSymbolList(text: string): string[] {
  return text
    .split(/[\s,;，、]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
