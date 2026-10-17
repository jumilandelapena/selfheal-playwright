import type { Candidate, FailureKind, TokenUsage } from '../types.js';

/** Everything the provider gets to know about one failure. */
export interface SuggestionRequest {
  testTitle: string;
  stepTitle?: string;
  relFile: string;
  line: number;
  statement: string;
  oldLocator: string;
  /** `click`, `fill`, `expect.toHaveText`, ... */
  action: string;
  /** Rendered action arguments, e.g. `'Buy milk'`. */
  actionArgs: string;
  failureKind: FailureKind;
  failureReason: string;
  errorExcerpt: string;
  page: {
    url: string;
    title: string;
    aria: string;
    dom: string;
    screenshotPng?: Buffer;
  };
}

export interface SuggestionResponse {
  candidates: Candidate[];
  usage: TokenUsage;
  /** Why no candidates came back (refusal, max_tokens, ...), when relevant. */
  note?: string;
}

export interface HealProvider {
  readonly name: string;
  readonly model?: string;
  suggest(request: SuggestionRequest): Promise<SuggestionResponse>;
}

/** Sort by confidence, clamp to [0, 1] and keep at most three candidates. */
export function normaliseCandidates(candidates: Candidate[]): Candidate[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      locator: candidate.locator.trim(),
      confidence: Math.min(1, Math.max(0, Number(candidate.confidence) || 0)),
    }))
    .filter((candidate) => candidate.locator.length > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}
