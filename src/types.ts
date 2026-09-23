/** 求解器输入 / 输出类型定义（全部为纯数据，可序列化） */

export interface SolverInput {
  /** 电流样本，整数，长度 6..600 */
  samples: number[];
  /** 有序唯一符号，长度 3..80 */
  symbols: string[];
  /** 与 symbols 对齐的目标电平（整数） */
  targets: number[];
  /** 统一驻留下限（含），段内样本数 ∈ [minDwell, maxDwell] */
  minDwell: number;
  /** 统一驻留上限（含） */
  maxDwell: number;
  /** 最大补偿 D，补偿取值 [-D, D]，D ∈ 0..8 */
  maxShift: number;
}

/** 单个 (位置, 补偿) 状态的字典键，形如 "p#c" */
export type StateKey = string;

export interface SolveResult {
  feasible: boolean;
  /** 不可行/非法时的首因（面向用户的中文说明） */
  reason?: string;
  /** 不可行时附带的结构性原因代码 */
  reasonCode?:
    | 'NO_PARTITION'
    | 'FIRST_SEGMENT'
    | 'MIDDLE_SEGMENT'
    | 'LAST_SEGMENT';

  n: number;
  k: number;
  minDwell: number;
  maxDwell: number;
  maxShift: number;

  /** 第一级目标：总绝对误差 */
  bestError?: number;
  /** 第二级目标：补偿变化总量 |c0| + Σ|c_i - c_{i-1}| */
  bestVariation?: number;

  /** 规范解：段长（与符号对齐） */
  lengths?: number[];
  /** 规范解：每段结束下标（最后一个为 n-1） */
  ends?: number[];
  /** 规范解：每段基线补偿 */
  shifts?: number[];
  /** 规范解：交错字典序向量 [end0, shift0, end1, shift1, ...] */
  canonicalVector?: number[];

  /** 每段结束下标在某条两级同优方案中的完整可达集合 */
  reachableEnds?: number[][];
  /** 每段补偿在某条两级同优方案中的完整可达集合 */
  reachableShifts?: number[][];
  /** 逐状态的可达标记（供页面轨迹联动高亮） */
  reachableStates?: Array<Set<StateKey>>;
  /** 全部边界点（相邻段之间的切点，内部位置）的可达集合 */
  reachableBoundaries?: number[];
}
