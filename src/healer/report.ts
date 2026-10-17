import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PRICE_PER_MILLION } from './providers/anthropic.js';
import type { HealRecord, HealReport, TokenUsage } from './types.js';

export function estimateCostUsd(usage: TokenUsage): number {
  const cost = (usage.inputTokens * PRICE_PER_MILLION.input + usage.outputTokens * PRICE_PER_MILLION.output) / 1_000_000;
  return Math.round(cost * 10_000) / 10_000;
}

export async function writeReports(report: HealReport, outDir: string): Promise<{ jsonPath: string; htmlPath: string }> {
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'heal-report.json');
  const htmlPath = path.join(outDir, 'heal-report.html');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(htmlPath, renderHtml(report, outDir), 'utf8');
  return { jsonPath, htmlPath };
}

/* ---------- Markdown (pull request body) ---------- */

export interface MarkdownOptions {
  title?: string;
  /** Link to the HTML report, relative to the repository root. */
  reportLink?: string;
  /** Resolve the "before" screenshot of a heal to a URL or path, or undefined to omit it. */
  screenshotUrl?: (record: HealRecord) => string | undefined;
}

const cell = (text: string | undefined): string => `\`${(text ?? '').replace(/\|/g, '\\|').replace(/`/g, '\u02cb')}\``;
const plain = (text: string | undefined): string => (text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderMarkdown(report: HealReport, options: MarkdownOptions = {}): string {
  const healed = report.heals.filter((heal) => heal.status === 'healed');
  const notHealed = report.tests.filter((test) => test.status !== 'healed');
  const s = report.summary;
  const lines: string[] = [];

  if (options.title) lines.push(`# ${options.title}`, '');
  lines.push(
    `The self-healing agent saw **${report.tests.length}** failing test(s) with **${s.failures}** locator failure(s), healed **${s.healedLocators}** locator(s) in **${s.healedTests}** test(s) and confirmed every patched file with a green run.`,
    '',
    'Please review each replacement: the agent only sees the page, not the product. Nothing is merged automatically.',
    '',
    '## Healed locators',
    '',
    '| Test | Old locator | New locator | Confidence | Reason |',
    '|---|---|---|---|---|',
  );
  for (const heal of healed) {
    lines.push(
      `| ${plain(heal.relFile)} › ${plain(heal.testTitle)} (L${heal.line}) | ${cell(heal.oldLocator)} | ${cell(heal.newLocator)} | ${heal.confidence?.toFixed(2) ?? ''} | ${plain(heal.reason)} |`,
    );
  }
  if (healed.length === 0) lines.push('| – | – | – | – | nothing healed |');

  const shots = healed
    .map((heal) => ({ heal, url: options.screenshotUrl?.(heal) }))
    .filter((entry): entry is { heal: HealRecord; url: string } => Boolean(entry.url));
  if (shots.length > 0) {
    lines.push('', '## Before screenshots', '');
    for (const { heal, url } of shots) {
      lines.push(
        '<details>',
        `<summary>${plain(heal.relFile)} › ${plain(heal.testTitle)} — ${plain(heal.oldLocator)}</summary>`,
        '',
        `![${plain(heal.testTitle)} before the heal](${url})`,
        '',
        '</details>',
        '',
      );
    }
  }

  if (notHealed.length > 0) {
    lines.push('', '## Not healed', '', '| Test | Outcome | Why |', '|---|---|---|');
    for (const test of notHealed) {
      lines.push(`| ${plain(test.relFile)} › ${plain(test.title)} | ${test.status} | ${plain(test.detail)} |`);
    }
  }

  lines.push(
    '',
    '## Heal report',
    '',
    `- Provider: ${report.provider}${report.model ? ` (${report.model})` : ''}`,
    `- Rounds: ${report.rounds} · Tokens: ${s.inputTokens} in / ${s.outputTokens} out · Estimated cost: $${s.estimatedCostUsd.toFixed(4)}`,
    `- Run: ${report.startedAt} → ${report.finishedAt} (${(report.durationMs / 1000).toFixed(1)}s)${report.appVersion ? ` · APP_VERSION=${report.appVersion}` : ''}`,
  );
  if (options.reportLink) lines.push(`- Full report: [${options.reportLink}](${options.reportLink})`);
  lines.push(
    '',
    '<details>',
    '<summary>Candidates that were checked</summary>',
    '',
    '| Heal | Candidate | Result |',
    '|---|---|---|',
  );
  for (const heal of report.heals) {
    for (const candidate of heal.candidates) {
      lines.push(`| ${heal.id} | ${cell(candidate.locator)} | ${candidate.status}: ${plain(candidate.detail)} |`);
    }
  }
  lines.push('', '</details>', '', '---', '', 'Opened by selfheal-playwright. Never merged automatically.', '');
  return lines.join('\n');
}

/* ---------- HTML ---------- */

const escapeHtml = (text: string | undefined): string =>
  (text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

function screenshotDataUrl(outDir: string, relPath: string | undefined): string | undefined {
  if (!relPath) return undefined;
  const file = path.join(outDir, relPath);
  if (!existsSync(file)) return undefined;
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
}

export function renderHtml(report: HealReport, outDir: string): string {
  const s = report.summary;
  const badge = (status: string): string => `<span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
  const prLine = !report.pr
    ? ''
    : report.pr.status === 'opened'
      ? `<p>Pull request: <a href="${escapeHtml(report.pr.url)}">${escapeHtml(report.pr.url)}</a> (branch <code>${escapeHtml(report.pr.branch)}</code>)</p>`
      : report.pr.status === 'written'
        ? `<p>Pull request body written to <code>${escapeHtml(report.pr.path)}</code>: ${escapeHtml(report.pr.reason)}</p>`
        : `<p>Pull request skipped: ${escapeHtml(report.pr.reason)}</p>`;

  const healRows = report.heals
    .map((heal) => {
      const shot = screenshotDataUrl(outDir, heal.screenshot);
      const candidates = heal.candidates
        .map(
          (c) =>
            `<li>${badge(c.status)} <code>${escapeHtml(c.locator)}</code> <small>(${c.kind}, ${c.confidence.toFixed(2)})</small><br><small>${escapeHtml(c.detail)}</small></li>`,
        )
        .join('');
      return `
<details class="heal">
<summary>${badge(heal.status)} <code>${escapeHtml(heal.relFile)}:${heal.line}</code> ${escapeHtml(heal.testTitle)} — <code>${escapeHtml(heal.oldLocator)}</code>${heal.newLocator ? ` → <code>${escapeHtml(heal.newLocator)}</code>` : ''}</summary>
<div class="body">
<p><b>Intent:</b> ${escapeHtml(heal.intent)} · <b>Action:</b> ${escapeHtml(heal.action)} · <b>Failure:</b> ${escapeHtml(heal.failureKind)} · <b>Round:</b> ${heal.round}</p>
<p><b>Outcome:</b> ${escapeHtml(heal.statusDetail)}${heal.reason ? ` · <b>Model's reason:</b> ${escapeHtml(heal.reason)}` : ''}</p>
${heal.pageUrl ? `<p><b>Page:</b> ${escapeHtml(heal.pageUrl)}</p>` : ''}
<p><b>Candidates</b></p><ul>${candidates || '<li>none</li>'}</ul>
<p><b>Error</b></p><pre>${escapeHtml(heal.errorExcerpt)}</pre>
${shot ? `<p><b>Before</b></p><img src="${shot}" alt="screenshot before the heal">` : ''}
</div>
</details>`;
    })
    .join('\n');

  const testRows = report.tests
    .map((t) => `<tr><td>${badge(t.status)}</td><td>${escapeHtml(t.relFile)}</td><td>${escapeHtml(t.title)}</td><td>${escapeHtml(t.detail)}</td></tr>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Heal report · selfheal-playwright</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#f6f7fb;color:#1c2333}
h1{margin:0 0 4px}.sub{color:#5d6b82;margin:0 0 20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}
.card{background:#fff;border:1px solid #d7dde8;border-radius:10px;padding:12px 14px}
.card b{display:block;font-size:24px}.card span{color:#5d6b82;font-size:13px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dde8;border-radius:10px;overflow:hidden}
td,th{padding:8px 10px;border-bottom:1px solid #e6eaf2;text-align:left;vertical-align:top}
code{background:#eef1f7;padding:1px 5px;border-radius:4px;font-size:13px}
pre{background:#1b2231;color:#e8edf7;padding:12px;border-radius:8px;overflow:auto;font-size:12px}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#e6eaf2}
.badge.healed,.badge.passed{background:#d8f3e3;color:#136c3e}.badge.reverted,.badge.rejected,.badge.unverified,.badge.no-candidate,.badge.unhealed{background:#fde2e1;color:#8f1d18}
.badge.skipped,.badge.pending{background:#fff1d6;color:#7a4b00}
details.heal{background:#fff;border:1px solid #d7dde8;border-radius:10px;margin:10px 0;padding:8px 12px}
details.heal summary{cursor:pointer}details.heal .body{padding:8px 0 4px}
img{max-width:100%;border:1px solid #d7dde8;border-radius:8px}
</style>
</head>
<body>
<h1>Heal report</h1>
<p class="sub">selfheal-playwright · provider ${escapeHtml(report.provider)}${report.model ? ` (${escapeHtml(report.model)})` : ''} · ${escapeHtml(report.startedAt)} · ${(report.durationMs / 1000).toFixed(1)}s${report.dryRun ? ' · dry run' : ''}${report.appVersion ? ` · APP_VERSION=${escapeHtml(report.appVersion)}` : ''}</p>
<div class="cards">
<div class="card"><b>${s.testsRun}</b><span>tests run</span></div>
<div class="card"><b>${s.failures}</b><span>failures seen</span></div>
<div class="card"><b>${s.healedTests}</b><span>tests healed</span></div>
<div class="card"><b>${s.healedLocators}</b><span>locators healed</span></div>
<div class="card"><b>${s.revertedLocators}</b><span>reverted</span></div>
<div class="card"><b>${s.unhealedTests + s.skippedFailures}</b><span>left for humans</span></div>
<div class="card"><b>$${s.estimatedCostUsd.toFixed(4)}</b><span>${s.inputTokens} in / ${s.outputTokens} out tokens</span></div>
</div>
${prLine}
<h2>Tests</h2>
<table><thead><tr><th>Status</th><th>File</th><th>Test</th><th>Detail</th></tr></thead><tbody>${testRows || '<tr><td colspan="4">No failing tests.</td></tr>'}</tbody></table>
<h2>Heals</h2>
${healRows || '<p>No heal attempts.</p>'}
<h2>Diff</h2>
<pre>${escapeHtml(report.diff || '(no changes)')}</pre>
</body>
</html>
`;
}
