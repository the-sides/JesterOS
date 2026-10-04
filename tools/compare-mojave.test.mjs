import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A transparent reference must not hide opaque content differences in the map
// or include its padding in the numerical score. Uses real ImageMagick, no mocks.
test('compares opaque RGB content and produces an opaque visible difference map', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mojave-comparison-'));
  try {
    const reference = join(directory, 'reference.png');
    const render = join(directory, 'render.png');
    const output = join(directory, 'comparison');
    for (const [name, bytes] of [
      ['reference', [100, 100, 100, 255, 255, 255, 255, 0]],
      ['render', [120, 100, 100, 255, 0, 0, 0, 255]],
    ]) {
      const raw = join(directory, `${name}.rgba`);
      writeFileSync(raw, Buffer.from(bytes));
      execFileSync('magick', ['-size', '2x1', '-depth', '8', `rgba:${raw}`, join(directory, `${name}.png`)]);
    }
    execFileSync('bun', ['tools/compare-mojave.mjs', reference, render, output]);
    const metric = JSON.parse(readFileSync(join(output, 'metrics.json'), 'utf8')).regions.window;
    expect(metric.opaquePixels).toBe(1);
    expect(metric.meanAbsoluteChannelError).toBeCloseTo(20 / 3, 8);
    expect(metric.normalizedRmsePercent).toBeCloseTo(Math.sqrt(400 / 3) / 255 * 100, 8);
    expect(metric.pixelsWithAnyChannelErrorAbove8Percent).toBe(100);
    const difference = execFileSync('magick', [join(output, 'difference-4x.png'), '-depth', '8', 'rgba:-']);
    expect([...difference.subarray(0, 4)]).toEqual([80, 0, 0, 255]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
