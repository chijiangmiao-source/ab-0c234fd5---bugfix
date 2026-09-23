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

  it('审计用例：页面规范向量/分段表/可达芯片/轨迹标记与求解结果一致', () => {
    // 样本 0,0,1,1,-2×6；五符号零目标；驻留 [2,2]、D=2
    const audit: Draft = {
      samplesText: '0 0 1 1 -2 -2 -2 -2 -2 -2',
      symbolsText: 'A B C D E',
      targetsText: ['0', '0', '0', '0', '0'],
      minDwell: '2',
      maxDwell: '2',
      maxShift: '2',
    };
    const html = render(audit);

    // 顶部横幅：E*=4、V*=2（SSR 可能插入注释占位，先剥离标签）
    const banner = html
      .slice(html.indexOf('banner ok'), html.indexOf('</div>', html.indexOf('banner ok')))
      .replace(/<[^>]+>/g, '')
      .replace(/<!--[^>]*-->/g, '')
      .replace(/\s+/g, ' ');
    expect(banner).toContain('E* = 4');
    expect(banner).toContain('V* = 2');

    // 交错向量（去标签后）：1,0,3,-1,5,-2,7,-2,9,-2
    const vectorStart = html.indexOf('aria-label="交错向量"');
    const vectorBox = html.slice(vectorStart, html.indexOf('</div>', vectorStart));
    const vectorText = vectorBox
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    expect(vectorText).toContain('1, 0, 3, -1, 5, -2, 7, -2, 9, -2');

    // 分段表：逐行抽取单元格纯文本
    const strip = (s: string) =>
      s
        .replace(/<!--[^>]*-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const rows = html
      .split('<tr')
      .slice(1)
      .filter((r) => r.includes('<td'))
      .map((r) => {
        const cells = r
          .split('<td')
          .slice(1)
          .map((c) => strip(c.slice(c.indexOf('>') + 1, c.lastIndexOf('</td>'))));
        return cells;
      })
      .filter((cells) => cells.length === 9);

    // 列：符号 / 区间 / 驻留 / 目标 / 补偿 / 生效电平 / 段误差 / 可达补偿 / 可达结束
    expect(rows.map((r) => r[1])).toEqual(['[0, 1]', '[2, 3]', '[4, 5]', '[6, 7]', '[8, 9]']);
    expect(rows.map((r) => r[2])).toEqual(['2', '2', '2', '2', '2']);
    expect(rows.map((r) => r[4])).toEqual(['0', '-1', '-2', '-2', '-2']);
    expect(rows.map((r) => r[5])).toEqual(['0', '-1', '-2', '-2', '-2']);
    expect(rows.map((r) => r[6])).toEqual(['0', '4', '0', '0', '0']);
    expect(rows.map((r) => r[7])).toEqual(['0', '-1 0', '-2 -1', '-2', '-2']);
    expect(rows.map((r) => r[8])).toEqual(['1', '3', '5', '7', '9']);

    // 段误差合计等于页面横幅的 E*
    const tableError = rows.reduce((acc, r) => acc + Number(r[6]), 0);
    expect(tableError).toBe(4);

    // 轨迹标记：4 个同优可达边界灰刻度 + 4 个规范边界蓝刻度 + 规范台阶线
    expect(html.match(/stroke="#6b7c91" stroke-width="1"/g)).toHaveLength(4);
    expect(html.match(/stroke="#4da3ff"\s+stroke-width="1\.6"/g)).toHaveLength(4);
    expect(html).toContain('stroke="#7ee0c2"');
  });
});
