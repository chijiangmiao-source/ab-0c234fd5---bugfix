import { useMemo } from 'react';
import type { SolveResult } from './types';

interface TraceChartProps {
  samples: number[];
  result: SolveResult;
  targets: number[];
  selected: number | null;
  onSelect: (i: number) => void;
}const PALETTE = ['#4da3ff', '#7ee0c2', '#ffb454', '#c792ea', '#f78c6c', '#82aaff'];

export function TraceChart({ samples, result, targets, selected, onSelect }: TraceChartProps) {
  const n = samples.length;
  const ends = result.ends!;
  const shifts = result.shifts!;
  const k = ends.length;

  const layout = useMemo(() => {
    const padL = 46;
    const padR = 14;
    const padT = 34;
    const padB = 30;
    const step = n <= 120 ? 8 : n <= 300 ? 5 : 3;
    const W = padL + (n - 1) * step + padR;
    const H = 320;
    const levels: number[] = [];
    samples.forEach((v) => levels.push(v));
    for (let i = 0; i < k; i++) levels.push(targets[i] + shifts[i]);
    if (result.reachableStates && selected !== null) {
      for (const key of result.reachableStates[selected]) {
        const [, c] = key.split('#').map(Number);
        levels.push(targets[selected] + c);
      }
    }
    let yMin = Math.min(...levels);
    let yMax = Math.max(...levels);
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const span = yMax - yMin;
    yMin -= span * 0.08;
    yMax += span * 0.14;
    const plotH = H - padT - padB;
    const x = (i: number) => padL + i * step;
    const y = (v: number) => padT + ((yMax - v) / (yMax - yMin)) * plotH;
    return { W, H, padL, padT, padB, x, y, yMin, yMax, step };
  }, [samples, result, targets, shifts, k, n, selected]);

  const starts = useMemo(() => {
    const s = [0];
    for (let i = 1; i < k; i++) s.push(ends[i - 1] + 1);
    return s;
  }, [ends, k]);

  const samplePoints = samples.map((v, i) => `${layout.x(i)},${layout.y(v)}`).join(' ');

  // 规范路径折线（电平台阶）
  const stepPath = useMemo(() => {
    const parts: string[] = [];
    for (let i = 0; i < k; i++) {
      const level = targets[i] + shifts[i];
      parts.push(`${i === 0 ? 'M' : 'L'}${layout.x(starts[i])},${layout.y(level)}`);
      parts.push(`L${layout.x(ends[i])},${layout.y(level)}`);
      if (i < k - 1) {
        const nextLevel = targets[i + 1] + shifts[i + 1];
        parts.push(`L${layout.x(ends[i])},${layout.y(nextLevel)}`);
      }
    }
    return parts.join('');
  }, [k, targets, shifts, starts, ends, layout]);

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const span = layout.yMax - layout.yMin;
    const rawStep = span / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const niceStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? rawStep;
    for (let v = Math.ceil(layout.yMin / niceStep) * niceStep; v <= layout.yMax; v += niceStep) {
      ticks.push(Math.round(v * 100) / 100);
    }
    return ticks;
  }, [layout]);

  const reachableDiamonds =
    selected !== null && result.reachableStates
      ? [...result.reachableStates[selected]].map((key) => {
          const [p, c] = key.split('#').map(Number);
          return { p, c, cx: layout.x(p), cy: layout.y(targets[selected] + c), canon: p === ends[selected] && c === shifts[selected] };
        })
      : [];

  return (
    <div className="chart-wrap">
      <svg width={layout.W} height={layout.H} style={{ minWidth: 720 }}>
        {/* 段背景（可点选） */}
        {starts.map((s, i) => {
          const x0 = layout.x(s) - layout.step / 2;
          const x1 = layout.x(ends[i]) + layout.step / 2;
          const color = PALETTE[i % PALETTE.length];
          return (
            <rect
              key={`bg-${i}`}
              x={x0}
              y={layout.padT - 18}
              width={Math.max(2, x1 - x0)}
              height={layout.H - layout.padT - layout.padB + 18}
              fill={selected === i ? color : color}
              fillOpacity={selected === i ? 0.14 : 0.045}
              stroke="none"
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(i)}
            />
          );
        })}

        {/* 网格与 y 轴刻度 */}
        {yTicks.map((v) => (
          <g key={`tick-${v}`}>
            <line
              x1={layout.padL - 6}
              x2={layout.W - 10}
              y1={layout.y(v)}
              y2={layout.y(v)}
              stroke="#2b3747"
              strokeDasharray="2 4"
            />
            <text x={layout.padL - 9} y={layout.y(v) + 3.5} textAnchor="end" fontSize="10" fill="#93a1b0">
              {v}
            </text>
          </g>
        ))}

        {/* 边界标尺：全部可达边界（灰短刻度）+ 规范边界（蓝长刻度） */}
        <line
          x1={layout.padL - 6}
          x2={layout.W - 10}
          y1={layout.padT - 12}
          y2={layout.padT - 12}
          stroke="#3a4a5e"
        />
        {result.reachableBoundaries!.map((p) => (
          <line
            key={`rb-${p}`}
            x1={layout.x(p) + layout.step / 2}
            x2={layout.x(p) + layout.step / 2}
            y1={layout.padT - 16}
            y2={layout.padT - 8}
            stroke="#6b7c91"
            strokeWidth="1"
          />
        ))}
        {ends.slice(0, -1).map((p) => (
          <g key={`cb-${p}`}>
            <line
              x1={layout.x(p) + layout.step / 2}
              x2={layout.x(p) + layout.step / 2}
              y1={layout.padT - 20}
              y2={layout.padT - 4}
              stroke="#4da3ff"
              strokeWidth="1.6"
            />
            <text x={layout.x(p) + layout.step / 2} y={layout.padT - 23} textAnchor="middle" fontSize="9" fill="#9cc8ff">
              {p}
            </text>
          </g>
        ))}

        {/* x 轴下标 */}
        {samples.map((_, i) =>
          i % Math.ceil(n / 30) === 0 || i === n - 1 ? (
            <text key={`x-${i}`} x={layout.x(i)} y={layout.H - 10} textAnchor="middle" fontSize="9" fill="#93a1b0">
              {i}
            </text>
          ) : null,
        )}

        {/* 样本轨迹 */}
        <polyline points={samplePoints} fill="none" stroke="#e6edf3" strokeWidth="1.3" opacity="0.75" />
        {n <= 120 &&
          samples.map((v, i) => (
            <circle key={`pt-${i}`} cx={layout.x(i)} cy={layout.y(v)} r="1.8" fill="#e6edf3" opacity="0.9" />
          ))}

        {/* 规范电平台阶 */}
        <path d={stepPath} fill="none" stroke="#7ee0c2" strokeWidth="2.2" strokeLinejoin="round" />

        {/* 选中段的同优可达状态（结束下标, 补偿对应电平） */}
        {reachableDiamonds.map((d) => (
          <path
            key={`d-${d.p}-${d.c}`}
            d={`M${d.cx},${d.cy - 3.2} L${d.cx + 3.2},${d.cy} L${d.cx},${d.cy + 3.2} L${d.cx - 3.2},${d.cy} Z`}
            fill={d.canon ? '#4da3ff' : 'none'}
            stroke={d.canon ? '#4da3ff' : '#8fa3b8'}
            strokeWidth="1.1"
          />
        ))}
      </svg>
      <div className="legend">
        <span>
          <span className="dot" style={{ background: '#e6edf3' }} />
          实测样本
        </span>
        <span>
          <span className="dot" style={{ background: '#7ee0c2' }} />
          规范路径（目标电平+补偿）
        </span>
        <span>
          <span className="dot" style={{ background: '#6b7c91' }} />
          同优可达边界（标尺灰刻度）
        </span>
        <span>
          <span className="dot" style={{ background: '#4da3ff' }} />
          规范边界 / 选中段可达状态◆
        </span>
      </div>
    </div>
  );
}
