import type { SolverInput } from './types';

export interface FieldError {
  field:
    | 'samples'
    | 'symbols'
    | 'targets'
    | 'minDwell'
    | 'maxDwell'
    | 'maxShift'
    | `targets.${number}`;
  reason: string;
}

const isInt = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x);

/**
 * 校验录入内容。返回首个错误（页面据此定位首因）；全部合法时返回 null。
 * 注意：结构合法不代表一定有解（驻留约束下可能无法完整分段），无解由求解器判定。
 */
export function validateInput(input: SolverInput): FieldError | null {
  const { samples, symbols, targets, minDwell, maxDwell, maxShift } = input;

  if (!Array.isArray(samples)) {
    return { field: 'samples', reason: '样本必须是数组' };
  }
  if (samples.length < 6 || samples.length > 600) {
    return {
      field: 'samples',
      reason: `样本数量需在 6 至 600 之间，当前为 ${samples.length}`,
    };
  }
  const badSample = samples.findIndex((x) => !isInt(x));
  if (badSample >= 0) {
    return {
      field: 'samples',
      reason: `第 ${badSample + 1} 个样本不是整数（样本必须全部为整数）`,
    };
  }

  if (!Array.isArray(symbols)) {
    return { field: 'symbols', reason: '符号必须是数组' };
  }
  if (symbols.length < 3 || symbols.length > 80) {
    return {
      field: 'symbols',
      reason: `符号数量需在 3 至 80 之间，当前为 ${symbols.length}`,
    };
  }
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    if (typeof s !== 'string' || s.trim() === '') {
      return { field: 'symbols', reason: `第 ${i + 1} 个符号为空` };
    }
  }
  const seen = new Set<string>();
  for (let i = 0; i < symbols.length; i++) {
    if (seen.has(symbols[i])) {
      return {
        field: 'symbols',
        reason: `符号「${symbols[i]}」重复（符号必须唯一，顺序保持录入顺序）`,
      };
    }
    seen.add(symbols[i]);
  }

  if (!Array.isArray(targets) || targets.length !== symbols.length) {
    return {
      field: 'targets',
      reason: `目标电平数量必须与符号数一致（${symbols.length} 个）`,
    };
  }
  for (let i = 0; i < targets.length; i++) {
    if (!isInt(targets[i])) {
      return { field: `targets.${i}`, reason: `符号「${symbols[i]}」的目标电平不是整数` };
    }
  }

  if (!isInt(minDwell) || minDwell < 1) {
    return { field: 'minDwell', reason: '驻留下限必须为不小于 1 的整数' };
  }
  if (!isInt(maxDwell) || maxDwell < 1) {
    return { field: 'maxDwell', reason: '驻留上限必须为不小于 1 的整数' };
  }
  if (minDwell > maxDwell) {
    return { field: 'minDwell', reason: `驻留下限（${minDwell}）不能大于上限（${maxDwell}）` };
  }
  if (!isInt(maxShift) || maxShift < 0 || maxShift > 8) {
    return { field: 'maxShift', reason: '最大补偿 D 必须为 0 至 8 的整数' };
  }

  return null;
}
