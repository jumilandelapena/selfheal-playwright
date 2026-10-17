/**
 * Build the README media from real artefacts:
 *
 *   docs/media/selfheal-demo.gif  — the console output of a real `pnpm heal`
 *                                   run (docs/demo-run.log), rendered frame by
 *                                   frame in headless Chromium and encoded as GIF
 *   docs/media/heal-report.png    — screenshot of docs/example/heal-report.html
 *
 *   pnpm exec tsx scripts/make-demo-media.ts
 */
import { chromium } from '@playwright/test';
import gifenc from 'gifenc';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

// gifenc ships CommonJS without named-export hints, so use the default import.
const { GIFEncoder, applyPalette, quantize } = gifenc;

const WIDTH = 880;
const HEIGHT = 520;
const VISIBLE_LINES = 24;
const LINES_PER_FRAME = 2;
const FRAME_DELAY_MS = 320;

const escapeHtml = (text: string): string =>
  text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

function colourise(line: string): string {
  const safe = escapeHtml(line);
  if (line.startsWith('✓')) return `<span class="green">${safe}</span>`;
  if (line.startsWith('▶')) return `<span class="cyan">${safe}</span>`;
  if (line.startsWith('!')) return `<span class="yellow">${safe}</span>`;
  if (line.startsWith('✗')) return `<span class="red">${safe}</span>`;
  if (line.startsWith('Done in')) return `<span class="bold">${safe}</span>`;
  return safe;
}

function frameHtml(lines: string[], command: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#0f1117}
  .win{width:${WIDTH}px;height:${HEIGHT}px;box-sizing:border-box;background:#0f1117;color:#e6e6e6;
       font:14px/1.45 "Cascadia Mono","Consolas","DejaVu Sans Mono",monospace;padding:14px 18px}
  .bar{display:flex;gap:8px;margin-bottom:10px}.dot{width:12px;height:12px;border-radius:50%}
  .title{margin-left:12px;color:#8b93a7;font-size:12px}
  pre{margin:0;white-space:pre-wrap;word-break:break-all}
  .green{color:#4ade80}.cyan{color:#67e8f9}.yellow{color:#fbbf24}.red{color:#f87171}.bold{font-weight:700;color:#fff}.prompt{color:#8b93a7}
  </style></head><body><div class="win">
  <div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="title">selfheal-playwright</span></div>
  <pre><span class="prompt">$</span> ${escapeHtml(command)}\n${lines.map(colourise).join('\n')}</pre></div></body></html>`;
}

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const log = readFileSync(path.join(root, 'docs', 'demo-run.log'), 'utf8').replace(/\r\n/g, '\n');
  const all = log.split('\n');
  const end = all.findIndex((line) => line.startsWith('Report:'));
  const lines = (end === -1 ? all : all.slice(0, end + 1)).filter((line) => !line.startsWith('  heal-0'));
  const prLine = all.find((line) => line.startsWith('! No pull request'));
  if (prLine) lines.push(prLine.replace(/Body saved to .*/, 'Body saved to heal-pr.md'));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const gif = GIFEncoder();
  const command = 'APP_VERSION=2 pnpm heal --provider mock --max-heals 30';

  const frames: string[][] = [];
  for (let shown = LINES_PER_FRAME; shown < lines.length + LINES_PER_FRAME; shown += LINES_PER_FRAME) {
    frames.push(lines.slice(Math.max(0, Math.min(shown, lines.length) - VISIBLE_LINES), Math.min(shown, lines.length)));
  }
  for (const [index, frame] of frames.entries()) {
    await page.setContent(frameHtml(frame, command));
    const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
    const rgba = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);
    const palette = quantize(rgba, 128);
    const indexed = applyPalette(rgba, palette);
    const last = index === frames.length - 1;
    gif.writeFrame(indexed, png.width, png.height, { palette, delay: last ? 4_000 : FRAME_DELAY_MS });
    process.stdout.write(`\rframe ${index + 1}/${frames.length}`);
  }
  gif.finish();
  const gifPath = path.join(root, 'docs', 'media', 'selfheal-demo.gif');
  writeFileSync(gifPath, gif.bytes());
  console.log(`\nwrote ${gifPath} (${(gif.bytes().length / 1024).toFixed(0)} kB, ${frames.length} frames)`);

  const reportPage = await browser.newPage({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 1 });
  await reportPage.goto(pathToFileURL(path.join(root, 'docs', 'example', 'heal-report.html')).href);
  await reportPage.locator('details.heal').first().evaluate((el) => el.setAttribute('open', ''));
  const shotPath = path.join(root, 'docs', 'media', 'heal-report.png');
  await reportPage.screenshot({ path: shotPath, fullPage: false });
  console.log(`wrote ${shotPath}`);
  await browser.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
