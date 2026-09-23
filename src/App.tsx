import { useEffect, useMemo, useRef, useState } from 'react';
import { solve, parseNumberList, parseSymbolList } from './solver';
import { validateInput } from './validation';
import { TraceChart } from './TraceChart';
import type { FieldError } from './validation';
import type { SolverInput, SolveResult } from './types';

const STORAGE_KEY = 'nanopore-review-draft-v1';

interface Draft {
  samplesText: string;
  symbolsText: string;
  targetsText: string[];
  minDwell: string;
  maxDwell: string;
  maxShift: string;
}

export type { Draft };

interface AppProps {
  /** 可选初始草稿（主要用于测试；正常使用时从 localStorage 恢复） */
  initialDraft?: Draft;
}

const DEFAULT_DRAFT: Draft = {
  samplesText: '0 0 1 5 5 5 4 1 0 0',
  symbolsText: 'A B C',
  targetsText: ['0', '5', '0'],
  minDwell: '2',
  maxDwell: '6',
  maxShift: '2',
};

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    /* localStorage 缺失（如 node/SSR）或草稿损坏时退回默认值 */
  }
  return DEFAULT_DRAFT;
}

export function App({ initialDraft }: AppProps = {}) {
  const [draft, setDraft] = useState<Draft>(initialDraft ?? loadDraft);
  const [selected, setSelected] = useState<number | null>(null);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* 存储不可用时静默退化为内存草稿 */
    }
  }, [draft]);

  const samples = useMemo(() => parseNumberList(draft.samplesText), [draft.samplesText]);
  const symbols = useMemo(() => parseSymbolList(draft.symbolsText), [draft.symbolsText]);
  const minDwell = Number(draft.minDwell);
  const maxDwell = Number(draft.maxDwell);
  const maxShift = Number(draft.maxShift);

  // 目标电平行随符号增删对齐（保留已录入值）
  const targetsText = useMemo(() => {
    const arr = draft.targetsText.slice(0, symbols.length);
    while (arr.length < symbols.length) arr.push('');
    return arr;
  }, [draft.targetsText, symbols.length]);
  const targets = targetsText.map((t) => Number(t));

  // 输入合法性 → 求解（非法或无解时草稿原样保留，仅给出首因）
  const parsed: SolverInput = { samples, symbols, targets, minDwell, maxDwell, maxShift };
  const fieldError: FieldError | null = validateInput(parsed);

  const result: SolveResult | null = useMemo(
    () => (fieldError === null ? solve(parsed) : null),
    // 解析结果均为原始类型 / 数组，字符串草稿变化即重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(samples), JSON.stringify(symbols), JSON.stringify(targets), minDwell, maxDwell, maxShift],
  );

  // 解变化后，选中段越界则回到第一段
  useEffect(() => {
    if (result?.feasible) {
      setSelected((s) => (s !== null && s < result.k ? s : 0));
    }
  }, [result]);

  const isStructural = fieldError === null && result && !result.feasible;

  const locateFirstCause = () => {
    if (!fieldError) return;
    let field = fieldError.field;
    if (field.startsWith('targets.')) field = 'targets';
    const el = fieldRefs.current[field];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const focusable = el.querySelector<HTMLElement>('textarea,input') ?? el;
      focusable.focus({ preventScroll: true });
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const fieldClass = (name: string) =>
    fieldError &&
    (fieldError.field === name || fieldError.field.startsWith(`${name}.`))
      ? 'field invalid'
      : 'field';

  const badTargetIndex =
    fieldError?.field.startsWith('targets.')
      ? Number(fieldError.field.split('.')[1])
      : -1;

  return (
    <div className="app">
      <header className="app-header">
        <h1>纳米孔电流轨迹分段 · 基线补偿复核台</h1>
        <span className="sub">
          全部计算在浏览器本地完成 · 无后端 · 不发起网络请求（静态资源除外）
        </span>
      </header>

      <div className="layout">
        {/* ---------------- 录入区（草稿始终保留） ---------------- */}
        <div>
          <section className="panel">
            <h2>录入</h2>

            <div
              className={fieldClass('samples')}
              ref={(el) => {
                fieldRefs.current.samples = el;
              }}
            >
              <label>
                <span>整数电流样本（6–600）</span>
                <span className="count">{samples.length} 个</span>
              </label>
              <textarea
                value={draft.samplesText}
                onChange={(e) => set('samplesText', e.target.value)}
                spellCheck={false}
                placeholder="以空格、逗号或换行分隔"
              />
            </div>

            <div
              className={fieldClass('symbols')}
              ref={(el) => {
                fieldRefs.current.symbols = el;
              }}
            >
              <label>
                <span>有序唯一符号（3–80，保持顺序）</span>
                <span className="count">{symbols.length} 个</span>
              </label>
              <textarea
                value={draft.symbolsText}
                onChange={(e) => set('symbolsText', e.target.value)}
                spellCheck={false}
                placeholder="例如：A B C"
              />
            </div>

            <div
              className={fieldClass('targets')}
              ref={(el) => {
                fieldRefs.current.targets = el;
              }}
            >
              <label>
                <span>各符号目标电平（整数，段内按 目标+补偿 计误差）</span>
              </label>
              <div className="target-grid">
                {symbols.map((s, i) => (
                  <div
                    key={i}
                    className={`target-cell${i === badTargetIndex ? ' invalid' : ''}`}
                    title={s}
                  >
                    <span className="sym">{s}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={targetsText[i] ?? ''}
                      onChange={(e) => {
                        const next = targetsText.slice();
                        next[i] = e.target.value;
                        set('targetsText', next);
                      }}
                      placeholder="t"
                      aria-label={`符号 ${s} 的目标电平`}
                    />
                  </div>
                ))}
                {symbols.length === 0 && <span className="note">请先录入符号</span>}
              </div>
            </div>

            <div>
              <div className="row-3">
                <div
                  className={fieldClass('minDwell')}
                  ref={(el) => {
                    fieldRefs.current.minDwell = el;
                  }}
                >
                  <label>
                    <span>驻留下限</span>
                  </label>
                  <input
                    type="number"
                    value={draft.minDwell}
                    onChange={(e) => set('minDwell', e.target.value)}
                  />
                </div>
                <div
                  className={fieldClass('maxDwell')}
                  ref={(el) => {
                    fieldRefs.current.maxDwell = el;
                  }}
                >
                  <label>
                    <span>驻留上限</span>
                  </label>
                  <input
                    type="number"
                    value={draft.maxDwell}
                    onChange={(e) => set('maxDwell', e.target.value)}
                  />
                </div>
                <div
                  className={fieldClass('maxShift')}
                  ref={(el) => {
                    fieldRefs.current.maxShift = el;
                  }}
                >
                  <label>
                    <span>最大补偿 D（0–8）</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={8}
                    value={draft.maxShift}
                    onChange={(e) => set('maxShift', e.target.value)}
                  />
                </div>
              </div>
              <div className="note">
                补偿约束：c₀ = 0；|cᵢ − cᵢ₋₁| ≤ 1；cᵢ ∈ [−D, D]。优化顺序：① 总绝对误差最小 →
                ② 补偿变化总量 |c₀|+Σ|cᵢ−cᵢ₋₁| 最小 → ③ 交错向量 [e₀,c₀,e₁,c₁,…] 字典序最小。
              </div>
            </div>

            <button className="link" onClick={() => setDraft(DEFAULT_DRAFT)}>
              重置为示例草稿
            </button>
          </section>
        </div>

        {/* ---------------- 结果区 ---------------- */}
        <div>
          {fieldError && (
            <div className="banner error" role="alert">
              <strong>输入非法（草稿已保留）：</strong>
              {fieldError.reason}
              <div className="preserve-hint">
                <button className="link" onClick={locateFirstCause}>
                  定位到首因字段 →
                </button>
              </div>
            </div>
          )}

          {isStructural && (
            <div className="banner error" role="alert">
              <strong>无解（草稿已保留）：</strong>
              {result.reason}
              <div className="note" style={{ color: '#ffc4c4' }}>
                结构原因代码：{result.reasonCode}。可尝试放宽驻留区间或调整样本/符号数量。
              </div>
            </div>
          )}

          {!fieldError && result?.feasible && (
            <FeasibleView
              result={result}
              samples={samples}
              symbols={symbols}
              targets={targets}
              selected={selected}
              onSelect={setSelected}
            />
          )}

          {!fieldError && !result && (
            <div className="banner warn">正在求解…</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FeasibleViewProps {
  result: SolveResult;
  samples: number[];
  symbols: string[];
  targets: number[];
  selected: number | null;
  onSelect: (i: number) => void;
}

function FeasibleView({ result, samples, symbols, targets, selected, onSelect }: FeasibleViewProps) {
  const { ends, shifts, lengths } = result;

  const segmentErrors = useMemo(() => {
    if (!ends || !shifts) return [];
    return ends.map((end, i) => {
      const start = i === 0 ? 0 : ends[i - 1] + 1;
      let sum = 0;
      for (let x = start; x <= end; x++) sum += Math.abs(samples[x] - (targets[i] + shifts[i]));
      return sum;
    });
  }, [ends, shifts, samples, targets]);

  return (
    <>
      <div className="banner ok">
        存在最优解：总绝对误差 E* = <strong>{result.bestError}</strong>，补偿变化总量 V* ={' '}
        <strong>{result.bestVariation}</strong>（{result.n} 样本 / {result.k} 段 / 驻留{' '}
        {result.minDwell}–{result.maxDwell} / D={result.maxShift}）。
      </div>

      <section className="panel">
        <h2>规范路径（两级最优中的交错字典序最小解）</h2>
        <div className="metrics">
          <div className="metric">
            <div className="k">E* 总绝对误差</div>
            <div className="v">{result.bestError}</div>
          </div>
          <div className="metric">
            <div className="k">V* 补偿变化总量</div>
            <div className="v">{result.bestVariation}</div>
          </div>
        </div>
        <div className="vector-box" aria-label="交错向量">
          [
          {result.canonicalVector!.map((v, i) => (
            <span key={i} className="pair">
              {i > 0 ? ', ' : ''}
              {v}
            </span>
          ))}
          ]
          <div className="note" style={{ marginTop: 4 }}>
            蓝色为结束下标 eᵢ，绿色为补偿 cᵢ；向量顺序 (e₀,c₀,e₁,c₁,…)。
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="segments">
            <thead>
              <tr>
                <th>符号</th>
                <th>样本区间</th>
                <th>驻留</th>
                <th>目标</th>
                <th>补偿 cᵢ</th>
                <th>生效电平</th>
                <th>段误差</th>
                <th>可达补偿（全部同优方案）</th>
                <th>可达结束下标</th>
              </tr>
            </thead>
            <tbody>
              {symbols.map((s, i) => {
                const start = i === 0 ? 0 : ends![i - 1] + 1;
                const isSel = selected === i;
                return (
                  <tr
                    key={s}
                    className={isSel ? 'selected' : ''}
                    onClick={() => onSelect(i)}
                  >
                    <td>
                      {i + 1}. {s}
                    </td>
                    <td>
                      [{start}, {ends![i]}]
                    </td>
                    <td>{lengths![i]}</td>
                    <td>{targets[i]}</td>
                    <td className={shifts![i] > 0 ? 'shift-pos' : shifts![i] < 0 ? 'shift-neg' : ''}>
                      {shifts![i] > 0 ? '+' : ''}
                      {shifts![i]}
                    </td>
                    <td>{targets[i] + shifts![i]}</td>
                    <td>{segmentErrors[i]}</td>
                    <td>
                      <span className="chips">
                        {result.reachableShifts![i].map((c) => (
                          <span
                            key={c}
                            className={`chip shift${c === shifts![i] ? ' canon' : ''}`}
                            title={c === shifts![i] ? '规范解取值' : '某条两级同优方案中的取值'}
                          >
                            {c > 0 ? '+' : ''}
                            {c}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>
                      <span className="chips">
                        {result.reachableEnds![i].map((p) => (
                          <span
                            key={p}
                            className={`chip end${p === ends![i] ? ' canon' : ''}`}
                            title={p === ends![i] ? '规范解边界' : '某条两级同优方案中的边界'}
                          >
                            {p}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="note">
          蓝色芯片为规范路径取值；其余芯片是“全部两级同优方案”在该段出现过的完整可达取值集合。
          任一行/芯片或图中色块可点选联动。
        </div>
      </section>

      <section className="panel">
        <h2>
          轨迹联动
          {selected !== null && (
            <span className="note" style={{ marginLeft: 8 }}>
              当前选中：第 {selected + 1} 段「{symbols[selected]}」—— ◇ 为该段在全部同优方案中的
              (结束下标, 补偿) 可达状态，蓝色实心 ◇ 为规范解。
            </span>
          )}
        </h2>
        <TraceChart
          samples={samples}
          result={result}
          targets={targets}
          selected={selected}
          onSelect={onSelect}
        />
      </section>
    </>
  );
}
