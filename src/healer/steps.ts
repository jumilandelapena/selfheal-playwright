/**
 * Turn the body of a Playwright test into a list of replayable steps.
 *
 * Supported statements:
 *   await page.goto(url)
 *   await <locator chain>.<action>(...literals)
 *   await expect(<locator chain> | page)[.not].<matcher>(...literals)
 *   await test.step(title, async () => { ...same statements... })
 *   test.beforeEach hooks of the file and of every enclosing describe block
 *
 * Anything else becomes an `unsupported` step. The healer refuses to replay
 * a test whose steps before the failure are not all supported, so it never
 * guesses about page state.
 */
import { Node, Project, SyntaxKind, type CallExpression, type Statement } from 'ts-morph';
import { isLocatorChain, normaliseLocatorText, toLiteral } from './locator-expression.js';
import { ACTION_VALUE_ARGS, UNSUPPORTED_MATCHERS } from './replay.js';
import type { Literal, ParsedTest, Step } from './types.js';

export class StepParseError extends Error {
  override name = 'StepParseError';
}

const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
let counter = 0;

const TEST_CALLEE = /^test(\.(only|skip|fixme|fail))?$/;
const DESCRIBE_CALLEE = /^(test\.describe(\.\w+)*|describe)$/;

function calleeText(call: CallExpression): string {
  return call.getExpression().getText().replace(/\s+/g, '');
}

function literalString(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  return undefined;
}

function callbackStatements(call: CallExpression): Statement[] | undefined {
  const fn = call.getArguments().find((arg) => Node.isArrowFunction(arg) || Node.isFunctionExpression(arg));
  if (!fn || !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return undefined;
  const body = fn.getBody();
  return Node.isBlock(body) ? body.getStatements() : undefined;
}

/** Parse the steps of one test. `specLine` disambiguates tests with equal titles. */
export function parseTestSteps(
  source: string,
  filePath: string,
  title: string,
  specLine?: number,
): ParsedTest {
  const file = project.createSourceFile(`__steps_${counter++}_${filePath.replace(/[^\w.]/g, '_')}`, source, {
    overwrite: true,
  });
  try {
    const testCall = findTestCall(file.getDescendantsOfKind(SyntaxKind.CallExpression), title, specLine);
    const body = callbackStatements(testCall);
    if (!body) throw new StepParseError(`test "${title}" has no block-bodied callback`);

    const steps: Step[] = [];
    for (const hook of collectBeforeEachHooks(file.getDescendantsOfKind(SyntaxKind.CallExpression), testCall)) {
      const hookBody = callbackStatements(hook);
      if (hookBody) steps.push(...statementsToSteps(hookBody));
    }
    steps.push(...statementsToSteps(body));
    return { title, line: testCall.getStartLineNumber(), steps };
  } finally {
    project.removeSourceFile(file);
  }
}

function findTestCall(calls: CallExpression[], title: string, specLine?: number): CallExpression {
  const matches = calls.filter(
    (call) => TEST_CALLEE.test(calleeText(call)) && literalString(call.getArguments()[0]) === title,
  );
  if (matches.length === 0) throw new StepParseError(`test "${title}" not found`);
  if (specLine !== undefined) {
    const exact = matches.find((call) => call.getStartLineNumber() === specLine);
    if (exact) return exact;
  }
  if (matches.length > 1) throw new StepParseError(`test "${title}" is defined more than once`);
  return matches[0]!;
}

/** `test.beforeEach` hooks that apply to a test: file-level first, then each enclosing describe. */
function collectBeforeEachHooks(calls: CallExpression[], testCall: CallExpression): CallExpression[] {
  const scopes: Node[] = [];
  let parent: Node | undefined = testCall.getParent();
  while (parent) {
    if (Node.isCallExpression(parent) && DESCRIBE_CALLEE.test(calleeText(parent))) scopes.push(parent);
    parent = parent.getParent();
  }
  scopes.push(testCall.getSourceFile());

  const scopeOf = (node: Node): Node => {
    let current: Node | undefined = node.getParent();
    while (current) {
      if (Node.isCallExpression(current) && DESCRIBE_CALLEE.test(calleeText(current))) return current;
      current = current.getParent();
    }
    return node.getSourceFile();
  };

  const hooks = calls.filter((call) => calleeText(call) === 'test.beforeEach' && scopes.includes(scopeOf(call)));
  // Outer scopes run first: the file, then describe blocks from the outside in.
  return hooks.sort((a, b) => scopes.indexOf(scopeOf(b)) - scopes.indexOf(scopeOf(a)));
}

function statementsToSteps(statements: Statement[], stepTitle?: string): Step[] {
  const steps: Step[] = [];
  for (const statement of statements) {
    const base = {
      startLine: statement.getStartLineNumber(),
      endLine: statement.getEndLineNumber(),
      text: statement.getText().trim(),
      ...(stepTitle !== undefined ? { stepTitle } : {}),
    };
    const unsupported = (reason: string): void => {
      steps.push({ kind: 'unsupported', ...base, reason });
    };

    if (!Node.isExpressionStatement(statement)) {
      unsupported(`${statement.getKindName()} is not a supported statement`);
      continue;
    }
    let expression: Node = statement.getExpression();
    if (Node.isAwaitExpression(expression)) expression = expression.getExpression();
    if (!Node.isCallExpression(expression)) {
      unsupported('only awaited method calls are supported');
      continue;
    }
    const callee = expression.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) {
      unsupported('only method calls are supported');
      continue;
    }
    const calleeName = callee.getText().replace(/\s+/g, '');

    try {
      if (calleeName === 'test.step') {
        const [titleArg] = expression.getArguments();
        const title = literalString(titleArg);
        const inner = callbackStatements(expression);
        if (title === undefined || !inner) {
          unsupported('test.step needs a literal title and a block callback');
          continue;
        }
        steps.push(...statementsToSteps(inner, title));
        continue;
      }

      if (calleeName === 'page.goto') {
        const [urlArg, optionsArg] = expression.getArguments();
        const url = urlArg ? toLiteral(urlArg) : undefined;
        if (typeof url !== 'string') {
          unsupported('page.goto needs a literal URL');
          continue;
        }
        const options = optionsArg ? toLiteral(optionsArg) : undefined;
        steps.push({
          kind: 'goto',
          ...base,
          url,
          ...(isRecord(options) ? { options } : {}),
        });
        continue;
      }

      const expectation = parseExpectCallee(callee);
      if (expectation) {
        const matcher = callee.getName();
        if (UNSUPPORTED_MATCHERS.has(matcher)) {
          unsupported(`expect().${matcher}() cannot run outside the test runner`);
          continue;
        }
        const args = expression.getArguments().map(toLiteral);
        const subject = expectation.subject;
        if (Node.isIdentifier(subject) && subject.getText() === 'page') {
          steps.push({ kind: 'expect', ...base, target: 'page', matcher, not: expectation.not, args });
        } else if (subject && isLocatorChain(subject)) {
          steps.push({
            kind: 'expect',
            ...base,
            target: 'locator',
            locator: normaliseLocatorText(subject.getText()),
            matcher,
            not: expectation.not,
            args,
          });
        } else {
          unsupported('expect() subject must be `page` or a locator chain');
        }
        continue;
      }

      const receiver = callee.getExpression();
      if (isLocatorChain(receiver)) {
        const action = callee.getName();
        if (!(action in ACTION_VALUE_ARGS)) {
          unsupported(`locator.${action}() is not a supported action`);
          continue;
        }
        steps.push({
          kind: 'action',
          ...base,
          locator: normaliseLocatorText(receiver.getText()),
          action,
          args: expression.getArguments().map(toLiteral),
        });
        continue;
      }
      unsupported('statement is not a page.goto, locator action, expect or test.step');
    } catch (error) {
      unsupported(error instanceof Error ? error.message : String(error));
    }
  }
  return steps;
}

function parseExpectCallee(callee: Node): { subject: Node | undefined; not: boolean } | undefined {
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  let base: Node = callee.getExpression();
  let not = false;
  if (Node.isPropertyAccessExpression(base) && base.getName() === 'not') {
    not = true;
    base = base.getExpression();
  }
  if (!Node.isCallExpression(base)) return undefined;
  const fn = base.getExpression().getText().replace(/\s+/g, '');
  if (fn !== 'expect' && fn !== 'expect.soft') return undefined;
  return { subject: base.getArguments()[0], not };
}

function isRecord(value: Literal | undefined): value is Record<string, Literal> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp);
}

/** Human-readable name of what a step does, e.g. `click` or `expect.not.toBeChecked`. */
export function describeStep(step: Step): string {
  switch (step.kind) {
    case 'goto':
      return 'goto';
    case 'action':
      return step.action;
    case 'expect':
      return `expect.${step.not ? 'not.' : ''}${step.matcher}`;
    case 'unsupported':
      return 'unsupported';
  }
}
