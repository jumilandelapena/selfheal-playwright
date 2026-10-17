/** Shared types for the self-healing agent. */

export type FailureKind =
  | 'locator-timeout'
  | 'strict-mode'
  | 'element-not-found'
  | 'assertion'
  | 'other';

export interface Classification {
  kind: FailureKind;
  /** True only for locator problems the agent is allowed to repair. */
  healable: boolean;
  /** The locator as Playwright printed it, e.g. `locator('#login-btn')`. */
  locator?: string;
  reason: string;
}

export interface TestFailure {
  /** Stable id: `<relative file>::<title>`. */
  id: string;
  /** Absolute path of the test file. */
  file: string;
  relFile: string;
  /** File the error was thrown in. Differs from `file` when it happened inside a helper or page object. */
  errorFile: string;
  title: string;
  titlePath: string[];
  /** Line of the `test(...)` call. */
  specLine: number;
  /** Line and column of the failing statement. */
  line: number;
  column: number;
  /** Error message with ANSI colours removed. */
  message: string;
  classification: Classification;
}

export interface RunResult {
  /** Ids of tests that passed. */
  passed: string[];
  failed: TestFailure[];
  total: number;
  reportPath: string;
}

/** JSON-ish literal values that may appear as locator or action arguments. */
export type Literal =
  | string
  | number
  | boolean
  | null
  | RegExp
  | Literal[]
  | { [key: string]: Literal };

interface StepBase {
  /** First and last line of the statement in the test file. */
  startLine: number;
  endLine: number;
  /** Source text of the statement. */
  text: string;
  /** Title of the enclosing `test.step`, if any. */
  stepTitle?: string;
}

export interface GotoStep extends StepBase {
  kind: 'goto';
  url: string;
  options?: Record<string, Literal>;
}

export interface ActionStep extends StepBase {
  kind: 'action';
  /** Locator expression, e.g. `page.locator('#login-btn')`. */
  locator: string;
  action: string;
  args: Literal[];
}

export interface ExpectStep extends StepBase {
  kind: 'expect';
  target: 'locator' | 'page';
  locator?: string;
  matcher: string;
  not: boolean;
  args: Literal[];
}

export interface UnsupportedStep extends StepBase {
  kind: 'unsupported';
  reason: string;
}

export type Step = GotoStep | ActionStep | ExpectStep | UnsupportedStep;

export interface ParsedTest {
  title: string;
  line: number;
  steps: Step[];
}

export type LocatorKind = 'role' | 'testid' | 'text' | 'label' | 'css';

export interface Candidate {
  locator: string;
  kind: LocatorKind;
  confidence: number;
  reason: string;
}

export interface CandidateResult extends Candidate {
  status: 'passed' | 'rejected' | 'skipped';
  detail: string;
  /** Number of elements the locator resolved to, when it was evaluated. */
  count?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type HealStatus =
  | 'pending'
  | 'healed'
  | 'reverted'
  | 'no-candidate'
  | 'unverified'
  | 'skipped';

export interface HealRecord {
  id: string;
  round: number;
  testId: string;
  testTitle: string;
  file: string;
  relFile: string;
  line: number;
  stepTitle?: string;
  /** What the test was trying to do: the step title or the test title. */
  intent: string;
  /** `click`, `fill`, `expect.toHaveText`, ... */
  action: string;
  oldLocator: string;
  errorLocator?: string;
  failureKind: FailureKind;
  errorExcerpt: string;
  pageUrl?: string;
  /** Path of the "before" screenshot, relative to the output directory. */
  screenshot?: string;
  candidates: CandidateResult[];
  newLocator?: string;
  confidence?: number;
  kind?: LocatorKind;
  reason?: string;
  status: HealStatus;
  statusDetail: string;
  usage?: TokenUsage;
}

export interface TestOutcome {
  testId: string;
  title: string;
  relFile: string;
  status: 'healed' | 'unhealed' | 'skipped';
  detail: string;
  /** Ids of the heal records that belong to this test. */
  heals: string[];
}

export type PullRequestOutcome =
  | { status: 'opened'; url: string; branch: string }
  | { status: 'written'; path: string; reason: string }
  | { status: 'skipped'; reason: string };

export interface HealReport {
  schemaVersion: 1;
  tool: 'selfheal-playwright';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  provider: string;
  model?: string;
  dryRun: boolean;
  appVersion?: string;
  baseUrl: string;
  options: {
    maxHeals: number;
    minConfidence: number;
    maxRounds: number;
    files: string[];
  };
  rounds: number;
  summary: {
    testsRun: number;
    failures: number;
    healableFailures: number;
    healedLocators: number;
    healedTests: number;
    revertedLocators: number;
    unhealedTests: number;
    skippedFailures: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  heals: HealRecord[];
  tests: TestOutcome[];
  /** Unified diff of every patched file, empty when nothing changed. */
  diff: string;
  pr?: PullRequestOutcome;
}
