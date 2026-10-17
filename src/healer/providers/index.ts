import { AnthropicProvider, type AnthropicProviderOptions } from './anthropic.js';
import { MockProvider } from './mock.js';
import type { HealProvider } from './types.js';

export type ProviderName = 'anthropic' | 'mock';

export interface CreateProviderOptions extends AnthropicProviderOptions {
  /** Path to a JSON file with mock answers; defaults to the bundled answers. */
  mockAnswersPath?: string;
}

export function createProvider(name: ProviderName, options: CreateProviderOptions = {}): HealProvider {
  if (name === 'mock') {
    return options.mockAnswersPath ? MockProvider.fromFile(options.mockAnswersPath) : new MockProvider();
  }
  const { mockAnswersPath: _ignored, ...anthropicOptions } = options;
  return new AnthropicProvider(anthropicOptions);
}

export { AnthropicProvider, MockProvider };
export type { HealProvider, SuggestionRequest, SuggestionResponse } from './types.js';
