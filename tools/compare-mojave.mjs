import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const [referenceArgument, renderArgument, outputArgument] = process.argv.slice(2);
if (!referenceArgument || !renderArgument || !outputArgument) {
  console.error('Usage: bun tools/compare-mojave.mjs reference.png render.png output-directory');
  process.exit(2);
}

const reference = resolve(referenceArgument);
const render = resolve(renderArgument);
const output = resolve(outputArgument);
const magick = (...arguments_) => execFileSync('magick', arguments_, { maxBuffer: 64 * 1024 * 1024 });
const dimensions = (path) => magick('identify', '-format', '%w %h', path).toString().trim().split(' ').map(Number);
const [width, height] = dimensions(reference);
const [renderWidth, renderHeight] = dimensions(render);
if (width !== renderWidth || height !== renderHeight) {
  throw new Error(`Dimensions must match without implicit resizing: reference ${width}×${height}, render ${renderWidth}×${renderHeight}`);
}
const referencePixels = magick(reference, '-colorspace', 'sRGB', '-depth', '8', 'rgba:-');
const renderPixels = magick(render, '-colorspace', 'sRGB', '-depth', '8', 'rgba:-');

function measure([left, top, regionWidth, regionHeight]) {
  let pixels = 0;
  let absoluteError = 0;
  let squaredError = 0;
  let changedPixels = 0;
  for (let y = top; y < top + regionHeight; y++) {
    for (let x = left; x < left + regionWidth; x++) {
      const offset = (y * width + x) * 4;
      // Apple supplies transparent padding, not a desktop background. Only
      // its opaque pixels are comparable; retain all opaque content and text.
      if (referencePixels[offset + 3] < 250) continue;
      let maximum = 0;
      for (let channel = 0; channel < 3; channel++) {
        const error = Math.abs(referencePixels[offset + channel] - renderPixels[offset + channel]);
        absoluteError += error;
        squaredError += error * error;
        maximum = Math.max(maximum, error);
      }
      if (maximum > 8) changedPixels++;
      pixels++;
    }
  }
  return {
    bounds: [left, top, regionWidth, regionHeight],
    opaquePixels: pixels,
    meanAbsoluteChannelError: absoluteError / (pixels * 3),
    normalizedRmsePercent: Math.sqrt(squaredError / (pixels * 3)) / 255 * 100,
    pixelsWithAnyChannelErrorAbove8Percent: changedPixels / pixels * 100,
  };
}

const regions = { window: [0, 0, width, height] };
if (width === 928 && height === 710) {
  Object.assign(regions, {
    toolbar: [0, 0, 928, 79],
    sidebar: [0, 79, 376, 631],
    conversation: [376, 79, 552, 574],
    composer: [376, 653, 552, 57],
  });
}
const report = {
  reference,
  render,
  dimensions: [width, height],
  method: '8-bit sRGB RGB-channel error; source alpha >= 250; no registration, resampling, content masks, or font masks',
  regions: Object.fromEntries(Object.entries(regions).map(([name, bounds]) => [name, measure(bounds)])),
};
mkdirSync(output, { recursive: true });
magick(reference, render, '-colorspace', 'sRGB', '-type', 'TrueColor', '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-compose', 'blend', '-define', 'compose:args=50,50', '-composite', join(output, 'overlay.png'));
magick(reference, render, '-colorspace', 'sRGB', '-type', 'TrueColor', '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-compose', 'difference', '-composite', '-evaluate', 'multiply', '4', join(output, 'difference-4x.png'));
writeFileSync(join(output, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const [source, name] of [[reference, 'reference.png'], [render, 'render.png']]) {
  const destination = join(output, name);
  if (source !== destination) copyFileSync(source, destination);
}
writeFileSync(join(output, 'index.html'), `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Mojave reference overlay</title>
<style>
body{margin:24px;background:#202124;color:#eee;font:14px system-ui}
header{display:flex;align-items:center;gap:20px;margin-bottom:16px}
input{width:220px}
.comparison{position:relative;width:${width}px;height:${height}px;background:white}
.comparison img{position:absolute;inset:0;width:100%;height:100%}
#reference{opacity:.5}
summary{cursor:pointer;margin:20px 0}
</style>
<header><strong>Mojave Messages — reference over browser render</strong>
<label>Reference opacity <input id="opacity" type="range" min="0" max="100" value="50"></label>
<output id="value">50%</output></header>
<p>Normalized RMSE: ${report.regions.window.normalizedRmsePercent.toFixed(3)}%. Nonzero is a real difference, not pixel identity.</p>
<div class="comparison"><img src="render.png" alt="Browser reconstruction"><img id="reference" src="reference.png" alt="Apple Mojave reference"></div>
<details><summary>4× amplified pixel differences</summary><img src="difference-4x.png" alt="Difference map"></details>
<p>Source alpha below 250 is excluded from metrics. No text/content masks. See metrics.json for regional errors.</p>
<script>document.querySelector('#opacity').addEventListener('input',event=>{document.querySelector('#reference').style.opacity=event.target.value/100;document.querySelector('#value').value=event.target.value+'%';});</script>
</html>`);
console.log(JSON.stringify(report, null, 2));
console.log(`Viewer: ${join(output, 'index.html')}\nOverlay: ${join(output, 'overlay.png')}\nDifference (4×): ${join(output, 'difference-4x.png')}`);
