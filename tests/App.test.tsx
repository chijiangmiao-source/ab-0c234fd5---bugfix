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

  it('审计用例：页面展示 E*=4 / V*=2、规范向量与逐段误差，可达补偿不再唯一', () => {
    const audit: Draft = {
      samplesText: '0 0 1 1 -2 -2 -2 -2 -2 -2',
      symbolsText: 'A B C D E',
      targetsText: ['0', '0', '0', '0', '0'],
      minDwell: '2',
      maxDwell: '2',
      maxShift: '2',
    };
    const html = render(audit);

    // 顶部最优值横幅与指标卡
    expect(html).toContain('规范路径');
    expect(html).toContain('总绝对误差');
    expect(html).toContain('补偿变化总量');
    expect(html).toContain('<strong>4</strong>');
    expect(html).toContain('<strong>2</strong>');

    // 规范补偿 0,-1,-2,-2,-2：向量盒与表格中均应出现负值补偿
    expect(html).toContain('-1');
    expect(html).toContain('-2');

    // 逐段误差：仅第 2 段（样本 [2,3]，生效电平 -1）误差为 4，其余段为 0
    expect(html).toContain('<td>4</td>');

    // 第二、三段的同优可达补偿芯片：-1 与 0（第二段）、-2 与 -1（第三段）
    // 芯片 class 为 "chip shift"，规范取值追加 canon
    expect(html).toMatch(/class="chip shift canon"[^>]*>\s*-1/);
    expect(html).toMatch(/class="chip shift"[^>]*>\s*0/);

    // 不应再出现求解器内部续接错误
    expect(html).not.toContain('内部错误');
    expect(html).not.toContain('无解');
  });
});
