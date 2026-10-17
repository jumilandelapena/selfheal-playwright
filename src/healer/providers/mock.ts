import { readFileSync } from 'node:fs';
import { normaliseLocatorText } from '../locator-expression.js';
import type { Candidate } from '../types.js';
import { normaliseCandidates, type HealProvider, type SuggestionRequest, type SuggestionResponse } from './types.js';

export type MockAnswers = Record<string, Candidate[]>;

/**
 * A provider with fixed answers keyed by the failing locator. It needs no API
 * key, so unit tests and CI can exercise the whole pipeline. Some answers
 * deliberately include a bad or low-confidence candidate to show that the
 * verifier and the confidence threshold do their job.
 */
export class MockProvider implements HealProvider {
  readonly name = 'mock';
  private readonly answers = new Map<string, Candidate[]>();
  readonly calls: SuggestionRequest[] = [];

  constructor(answers: MockAnswers = loadDefaultAnswers()) {
    for (const [locator, candidates] of Object.entries(answers)) {
      this.answers.set(normaliseLocatorText(locator), candidates);
    }
  }

  static fromFile(path: string): MockProvider {
    return new MockProvider(JSON.parse(readFileSync(path, 'utf8')) as MockAnswers);
  }

  async suggest(request: SuggestionRequest): Promise<SuggestionResponse> {
    this.calls.push(request);
    const candidates = this.answers.get(normaliseLocatorText(request.oldLocator)) ?? [];
    return {
      candidates: normaliseCandidates(candidates),
      usage: { inputTokens: 0, outputTokens: 0 },
      ...(candidates.length === 0 ? { note: 'no mock answer for this locator' } : {}),
    };
  }
}

export function loadDefaultAnswers(): MockAnswers {
  return JSON.parse(readFileSync(new URL('./mock-answers.json', import.meta.url), 'utf8')) as MockAnswers;
}
