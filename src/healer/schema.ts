import { z } from 'zod';

/**
 * The exact JSON the model must return. Constraints that structured outputs
 * cannot express (max 3 items, 0..1 range) are enforced after parsing.
 */
export const CandidateSchema = z.object({
  locator: z
    .string()
    .describe('A complete Playwright TypeScript locator expression that starts with `page.`'),
  kind: z
    .enum(['role', 'testid', 'text', 'label', 'css'])
    .describe('Locator family of the first call: getByRole=role, getByTestId=testid, getByText=text, getByLabel/getByPlaceholder=label, locator()=css'),
  confidence: z.number().describe('How sure you are that this is the element the test meant, from 0 to 1'),
  reason: z.string().describe('One sentence explaining why this is the same element'),
});

export const SuggestionSchema = z.object({
  candidates: z
    .array(CandidateSchema)
    .describe('At most 3 candidates sorted by confidence, highest first. Empty when nothing on the page matches the intent.'),
});

export type Suggestion = z.infer<typeof SuggestionSchema>;
