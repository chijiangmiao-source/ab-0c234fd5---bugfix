import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from '../src/App';
import type { Draft } from '../src/App';

const render = (draft?: Draft) => renderToString(<App initialDraft={draft} />);

describe('复核页渲染（SSR 冒烟，node 环境无 localStorage 亦不崩溃）', () => {
  it('默认草稿：渲染录入面板、规范结果、轨迹联动与交错向量', () => {
    const html = render();
    expect(html).toContain('录入');
    expect(html).toContain('规范路径');
    expect(html).toContain('轨迹联动');
    expect(html).toContain('总绝对误差');
    expect(html).toContain('可达补偿');
    expect(html).toContain('可达结束下标');
  });

  it('非法输入：保留草稿文案与首因，不渲染结果面板', () => {
    const bad: Draft = {
      samplesText: '1 2 3',
      symbolsText: 'A B C',
      targetsText: ['0', '0', '0'],
      minDwell: '1',
      maxDwell: '6',
      maxShift: '2',
    };
    const html = render(bad);
    expect(html).toContain('输入非法（草稿已保留）');
    expect(html).toContain('样本数量需在 6 至 600');
    expect(html).toContain('定位到首因字段');
    expect(html).not.toContain('规范路径');
  });

  it('无解：显示无解横幅与原因代码', () => {
    const infeasible: Draft = {
      samplesText: '0 0 0 0 0 0',
      symbolsText: 'A B C',
      targetsText: ['0', '0', '0'],
      minDwell: '3',
      maxDwell: '10',
      maxShift: '0',
    };
    const html = render(infeasible);
    expect(html).toContain('无解（草稿已保留）');
    expect(html).toContain('FIRST_SEGMENT');
    expect(html).not.toContain('规范路径');
  });
});
