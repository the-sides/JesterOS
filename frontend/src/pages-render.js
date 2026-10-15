import { pagesMargins } from './pages-model.js';

export const PAGES_CHART_COLORS = Object.freeze(['#4a92ce', '#85bb57', '#e6b345', '#de745e', '#9476ad', '#48b2ac']);
export function pagesChartGeometry(chart, width = 420, height = 240) {
  const colors = PAGES_CHART_COLORS, marks = [], labels = [], left = 38, right = width - 12, top = 18, bottom = height - 35;
  if (chart.kind === 'pie') {
    const total = chart.values.reduce((sum, value) => sum + value, 0), cx = width * .35, cy = height / 2, radius = Math.min(height * .4, width * .26); let angle = -Math.PI / 2;
    chart.values.forEach((value, index) => { const sweep = total ? value / total * Math.PI * 2 : 0, steps = Math.max(1, Math.ceil(sweep * 30)), points = [[cx, cy]]; for (let step = 0; step <= steps; step++) { const a = angle + sweep * step / steps; points.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]); } marks.push({ type: 'polygon', points, color: colors[index % colors.length] }); labels.push({ x: width * .66, y: 25 + index * Math.min(17, (height - 45) / chart.values.length), text: `${chart.labels[index]}: ${value}`, color: colors[index % colors.length] }); angle += sweep; });
  } else {
    const minimum = Math.min(0, ...chart.values), maximum = Math.max(1, ...chart.values), scale = value => bottom - (value - minimum) / (maximum - minimum) * (bottom - top), zero = scale(0), count = chart.values.length;
    marks.push({ type: 'line', x1: left, y1: zero, x2: right, y2: zero, color: '#999999' });
    const points = chart.values.map((value, index) => [left + (index + .5) / count * (right - left), scale(value)]);
    if (chart.kind === 'bar') points.forEach(([x, y], index) => marks.push({ type: 'rect', x: x - (right - left) / count * .32, y: Math.min(y, zero), width: (right - left) / count * .64, height: Math.max(.5, Math.abs(y - zero)), color: colors[index % colors.length] }));
    else { points.forEach(([x, y], index) => { if (index) marks.push({ type: 'line', x1: points[index - 1][0], y1: points[index - 1][1], x2: x, y2: y, color: colors[0] }); marks.push({ type: 'circle', x, y, radius: 3, color: colors[0] }); }); }
    points.forEach(([x, y], index) => { labels.push({ x, y: height - 17, text: chart.labels[index], color: '#555555', center: true }); labels.push({ x, y: Math.max(12, y - 5), text: String(chart.values[index]), color: '#555555', center: true }); });
  }
  return { width, height, marks, labels };
}
export function pagesEstimatePages(content) {
  const margin = pagesMargins(content.page), usable = content.page.height - margin.top - margin.bottom, width = content.page.width - margin.left - margin.right; let page = [], used = 0; const pages = [page];
  for (const block of content.blocks) {
    const height = block.type === 'paragraph' ? Math.max(...block.runs.map(run => run.size)) * 1.3 * Math.max(1, Math.ceil(block.runs.reduce((sum, run) => sum + run.text.length * run.size * .52, 0) / width)) + 10 : block.type === 'image' ? Math.min(block.height, usable) + 10 : block.type === 'chart' ? 290 : block.rows.length * 29 + 10;
    if (page.length && (block.pageBreakBefore || used + height > usable)) { page = []; pages.push(page); used = 0; } page.push(block.id); used += height;
  }
  return pages;
}
