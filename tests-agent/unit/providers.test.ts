import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider, DEFAULT_MODEL, buildUserMessage } from '../../src/healer/providers/anthropic.js';
import { MockProvider } from '../../src/healer/providers/mock.js';
import type { SuggestionRequest } from '../../src/healer/providers/types.js';

const request: SuggestionRequest = {
  testTitle: 'shows an error for a wrong password',
  stepTitle: 'submit',
  relFile: 'tests/login.spec.ts',
  line: 11,
  statement: "await page.locator('#login-btn').click();",
  oldLocator: "page.locator('#login-btn')",
  action: 'click',
  actionArgs: '',
  failureKind: 'locator-timeout',
  failureReason: 'locator.click timed out waiting for the element',
  errorExcerpt: 'TimeoutError: locator.click: Timeout 3000ms exceeded.',
  page: {
    url: 'http://localhost:4173/login',
    title: 'Login · Taskly',
    aria: '- button "Sign in"',
    dom: '<button data-testid="signin">Sign in</button>',
    screenshotPng: Buffer.from('png'),
  },
};

describe('MockProvider', () => {
  it('answers from the bundled table, keyed by the normalised locator', async () => {
    const provider = new MockProvider();
    const response = await provider.suggest({ ...request, oldLocator: "locator('#login-btn');" });
    expect(response.candidates[0]).toMatchObject({ locator: "page.getByRole('button', { name: 'Sign in' })", kind: 'role' });
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('returns no candidates for unknown locators', async () => {
    const response = await new MockProvider().suggest({ ...request, oldLocator: "page.locator('#unknown')" });
    expect(response.candidates).toEqual([]);
    expect(response.note).toContain('no mock answer');
  });

  it('sorts custom answers by confidence and keeps at most three', async () => {
    const provider = new MockProvider({
      "page.locator('#x')": [
        { locator: "page.getByText('a')", kind: 'text', confidence: 0.2, reason: '' },
        { locator: "page.getByText('b')", kind: 'text', confidence: 0.9, reason: '' },
        { locator: "page.getByText('c')", kind: 'text', confidence: 1.7, reason: '' },
        { locator: "page.getByText('d')", kind: 'text', confidence: 0.5, reason: '' },
      ],
    });
    const { candidates } = await provider.suggest({ ...request, oldLocator: "page.locator('#x')" });
    expect(candidates.map((c) => c.confidence)).toEqual([1, 0.9, 0.5]);
  });
});

function fakeClient(message: Partial<Anthropic.Message> & { parsed_output?: unknown }): { client: Anthropic; parse: ReturnType<typeof vi.fn> } {
  const parse = vi.fn().mockResolvedValue({
    stop_reason: 'end_turn',
    usage: { input_tokens: 1200, output_tokens: 80 },
    ...message,
  });
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

describe('AnthropicProvider', () => {
  it('requires an API key unless a client is injected', () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new AnthropicProvider()).toThrow('ANTHROPIC_API_KEY');
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it('calls messages.parse with the fixed model, a zod output format and the screenshot', async () => {
    const { client, parse } = fakeClient({
      parsed_output: {
        candidates: [
          { locator: "getByTestId('signin')", kind: 'testid', confidence: 0.6, reason: 'test id' },
          { locator: "page.getByRole('button', { name: 'Sign in' })", kind: 'role', confidence: 0.95, reason: 'role' },
        ],
      },
    });
    const provider = new AnthropicProvider({ client, effort: 'medium' });
    const response = await provider.suggest(request);

    expect(parse).toHaveBeenCalledTimes(1);
    const params = parse.mock.calls[0]?.[0] as Anthropic.MessageCreateParams & { output_config: Record<string, unknown> };
    expect(params.model).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe('claude-opus-5-5');
    expect(params.output_config.format).toBeDefined();
    expect(params.output_config.effort).toBe('medium');
    const content = params.messages[0]?.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
    expect(content[1]).toMatchObject({ type: 'text' });

    expect(response.usage).toEqual({ inputTokens: 1200, outputTokens: 80 });
    expect(response.candidates.map((c) => c.locator)).toEqual([
      "page.getByRole('button', { name: 'Sign in' })",
      "getByTestId('signin')",
    ]);
  });

  it('treats refusal, max_tokens and unparseable output as "no suggestion"', async () => {
    for (const [stop, note] of [
      ['refusal', 'declined'],
      ['max_tokens', 'cut off'],
    ] as const) {
      const { client } = fakeClient({ stop_reason: stop, parsed_output: { candidates: [{ locator: 'page.getByText(\'x\')', kind: 'text', confidence: 1, reason: '' }] } });
      const response = await new AnthropicProvider({ client }).suggest(request);
      expect(response.candidates).toEqual([]);
      expect(response.note).toContain(note);
    }
    const { client } = fakeClient({ parsed_output: null });
    const response = await new AnthropicProvider({ client }).suggest(request);
    expect(response.candidates).toEqual([]);
    expect(response.note).toContain('schema');
  });

  it('describes the failure, the intent and the page in the user message', () => {
    const text = buildUserMessage(request);
    expect(text).toContain('Test: "shows an error for a wrong password"');
    expect(text).toContain('Step: "submit"');
    expect(text).toContain("Failing locator: page.locator('#login-btn')");
    expect(text).toContain('- button "Sign in"');
    expect(text).toContain('<button data-testid="signin">Sign in</button>');
  });
});
