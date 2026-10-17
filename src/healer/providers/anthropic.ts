import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { SuggestionSchema } from '../schema.js';
import { normaliseCandidates, type HealProvider, type SuggestionRequest, type SuggestionResponse } from './types.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** Published list prices for claude-opus-5-5, USD per million tokens. */
export const PRICE_PER_MILLION = { input: 4, output: 20 } as const;

export type Effort = 'low' | 'medium' | 'high';

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  /** Reasoning effort. Locator repair is a narrow task, so `low` is the default. */
  effort?: Effort;
  /** Send the screenshot along with the DOM. Costs roughly 1.2k input tokens. */
  includeScreenshot?: boolean;
  /** Mainly for tests: inject a pre-built client. */
  client?: Anthropic;
}

export const SYSTEM_PROMPT = `You repair broken Playwright locators in end-to-end tests.

You receive the test's intent, the locator that no longer matches, the action the test performs with it, and the current page (accessibility tree, trimmed HTML and a screenshot). Find the element the test author meant and propose locators for it.

Rules:
1. Return at most 3 candidates sorted by confidence (highest first). Each candidate is a complete Playwright TypeScript expression starting with \`page.\`, for example page.getByRole('button', { name: 'Sign in' }).
2. Prefer, in this order: page.getByRole(...), page.getByTestId(...), page.getByLabel(...) or page.getByPlaceholder(...), page.getByText(...), and only then CSS through page.locator(...). Use CSS only when no accessible or test-id locator can identify the element on its own.
3. Never use nth-child or nth-of-type chains, positional helpers such as first(), last() or nth(), XPath, or auto-generated class names (for example css-1x2y3z, sc-AbC12, Button_root__x1y2z).
4. The candidate must match exactly one element, and that element must fulfil the same intent as the original locator. Add { exact: true } when similar texts exist on the page.
5. For actions (click, fill, check, selectOption) target the interactive element itself: the input, not its label; the button, not an icon inside it.
6. If nothing on the page matches the intent, return an empty candidates list. Do not guess.
7. The "kind" field is the family of the first call: getByRole=role, getByTestId=testid, getByText=text, getByLabel or getByPlaceholder=label, locator=css.`;

export function buildUserMessage(request: SuggestionRequest): string {
  const lines = [
    '## Failing test',
    `File: ${request.relFile} (line ${request.line})`,
    `Test: "${request.testTitle}"`,
  ];
  if (request.stepTitle) lines.push(`Step: "${request.stepTitle}"`);
  lines.push(
    `Failing statement: ${request.statement}`,
    `Failing locator: ${request.oldLocator}`,
    `Action performed with it: ${request.action}${request.actionArgs ? ` with arguments ${request.actionArgs}` : ''}`,
    `Failure: ${request.failureKind} (${request.failureReason})`,
    '',
    '## Error excerpt',
    '```',
    request.errorExcerpt,
    '```',
    '',
    '## Current page',
    `URL: ${request.page.url}`,
    `Title: ${request.page.title}`,
    '',
    '### Accessibility tree (ARIA snapshot)',
    '```yaml',
    request.page.aria,
    '```',
    '',
    '### Trimmed DOM of <body>',
    '```html',
    request.page.dom,
    '```',
  );
  return lines.join('\n');
}

export class AnthropicProvider implements HealProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: Effort;
  private readonly includeScreenshot: boolean;

  constructor(options: AnthropicProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!options.client && !apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Export it, or run with --provider mock.');
    }
    this.client = options.client ?? new Anthropic({ apiKey, maxRetries: 2 });
    this.model = options.model ?? DEFAULT_MODEL;
    this.effort = options.effort ?? 'low';
    this.includeScreenshot = options.includeScreenshot ?? true;
  }

  async suggest(request: SuggestionRequest): Promise<SuggestionResponse> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (this.includeScreenshot && request.page.screenshotPng) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: request.page.screenshotPng.toString('base64') },
      });
    }
    content.push({ type: 'text', text: buildUserMessage(request) });

    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      output_config: {
        format: zodOutputFormat(SuggestionSchema),
        effort: this.effort,
      },
    });

    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };

    // Check why the model stopped before trusting the parsed output.
    if (response.stop_reason === 'refusal') {
      return { candidates: [], usage, note: 'the model declined to answer (stop_reason=refusal)' };
    }
    if (response.stop_reason === 'max_tokens') {
      return { candidates: [], usage, note: 'the answer was cut off (stop_reason=max_tokens)' };
    }
    if (!response.parsed_output) {
      return { candidates: [], usage, note: 'the answer did not match the expected JSON schema' };
    }
    return { candidates: normaliseCandidates(response.parsed_output.candidates), usage };
  }
}
