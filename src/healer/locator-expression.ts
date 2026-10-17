/**
 * Safe handling of Playwright locator expressions such as
 * `page.getByRole('button', { name: 'Sign in' })`.
 *
 * Expressions are parsed into an AST with ts-morph and rebuilt by calling
 * Playwright methods one by one. Nothing is ever `eval`-ed, so a candidate
 * returned by the AI can only ever be a locator chain on `page`.
 */
import type { Locator, Page } from '@playwright/test';
import { Node, Project, SyntaxKind, type CallExpression, type Expression } from 'ts-morph';
import type { Literal } from './types.js';

export const PAGE_ROOT = 'page';

/** Methods that are allowed in a locator chain (on `page` or on a locator). */
export const LOCATOR_METHODS: ReadonlySet<string> = new Set([
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByTestId',
  'getByTitle',
  'getByAltText',
  'filter',
  'first',
  'last',
  'nth',
  'and',
  'or',
]);

/** Positional helpers are fine in existing tests but never in a new candidate. */
const POSITIONAL_METHODS: ReadonlySet<string> = new Set(['first', 'last', 'nth']);

export class LocatorExpressionError extends Error {
  override name = 'LocatorExpressionError';
}

/** A nested locator used as an option value, e.g. `filter({ has: page.locator('li') })`. */
export class LocatorRef {
  constructor(readonly parsed: ParsedLocator) {}
}

export type LocatorArg = Literal | LocatorRef | LocatorArg[] | { [key: string]: LocatorArg };

export interface LocatorCall {
  method: string;
  args: LocatorArg[];
}

export interface ParsedLocator {
  /** Normalised source text. */
  text: string;
  calls: LocatorCall[];
}

const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
let counter = 0;

/** Collapse whitespace, drop a trailing semicolon and add the `page.` prefix if missing. */
export function normaliseLocatorText(text: string): string {
  let out = text.trim().replace(/\s+/g, ' ').replace(/;$/, '').trim();
  if (/^(locator|getBy[A-Za-z]+)\(/.test(out)) out = `${PAGE_ROOT}.${out}`;
  return out;
}

/** Parse a locator expression. Throws `LocatorExpressionError` when it is not a plain locator chain. */
export function parseLocatorExpression(text: string): ParsedLocator {
  const normalised = normaliseLocatorText(text);
  const file = project.createSourceFile(`__locator_${counter++}.ts`, `const __l = ${normalised};`, {
    overwrite: true,
  });
  try {
    const parseErrors = (file.compilerNode as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
    if (parseErrors && parseErrors.length > 0) {
      throw new LocatorExpressionError(`not valid TypeScript: ${normalised}`);
    }
    const statement = file.getStatements()[0];
    if (!statement || !Node.isVariableStatement(statement) || file.getStatements().length !== 1) {
      throw new LocatorExpressionError(`expected a single expression: ${normalised}`);
    }
    const initializer = statement.getDeclarations()[0]?.getInitializer();
    if (!initializer) throw new LocatorExpressionError(`expected an expression: ${normalised}`);
    return { text: normalised, calls: parseChain(initializer) };
  } finally {
    project.removeSourceFile(file);
  }
}

/** Walk a call chain down to `page`, validating every method on the way. */
export function parseChain(node: Expression): LocatorCall[] {
  if (!Node.isCallExpression(node)) {
    throw new LocatorExpressionError(`expected a method call, got ${node.getKindName()}: ${node.getText()}`);
  }
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) {
    throw new LocatorExpressionError(`expected a method call on \`${PAGE_ROOT}\`: ${node.getText()}`);
  }
  const method = callee.getName();
  if (!LOCATOR_METHODS.has(method)) {
    throw new LocatorExpressionError(`\`${method}()\` is not a locator method`);
  }
  const receiver = callee.getExpression();
  const prefix =
    Node.isIdentifier(receiver) && receiver.getText() === PAGE_ROOT ? [] : parseChain(receiver);
  const args = node.getArguments().map((arg) => toValue(arg, true));
  return [...prefix, { method, args }];
}

/** True when the node is a locator chain rooted at `page`. Never throws. */
export function isLocatorChain(node: Node): node is CallExpression {
  if (!Node.isCallExpression(node)) return false;
  try {
    parseChain(node);
    return true;
  } catch {
    return false;
  }
}

/** Convert a literal AST node (string, number, regex, object, array, ...) to a value. */
export function toLiteral(node: Node): Literal {
  return toValue(node, false) as Literal;
}

function toValue(node: Node, allowLocators: boolean): LocatorArg {
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isSatisfiesExpression(node)) {
    return toValue(node.getExpression(), allowLocators);
  }
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  if (Node.isNumericLiteral(node)) return node.getLiteralValue();
  if (Node.isPrefixUnaryExpression(node)) {
    const operand = node.getOperand();
    if (Node.isNumericLiteral(operand)) {
      const value = operand.getLiteralValue();
      if (node.getOperatorToken() === SyntaxKind.MinusToken) return -value;
      if (node.getOperatorToken() === SyntaxKind.PlusToken) return value;
    }
    throw new LocatorExpressionError(`unsupported expression: ${node.getText()}`);
  }
  switch (node.getKind()) {
    case SyntaxKind.TrueKeyword:
      return true;
    case SyntaxKind.FalseKeyword:
      return false;
    case SyntaxKind.NullKeyword:
      return null;
    default:
      break;
  }
  if (Node.isRegularExpressionLiteral(node)) {
    const text = node.getText();
    const lastSlash = text.lastIndexOf('/');
    return new RegExp(text.slice(1, lastSlash), text.slice(lastSlash + 1));
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().map((element) => toValue(element, allowLocators));
  }
  if (Node.isObjectLiteralExpression(node)) {
    const out: { [key: string]: LocatorArg } = {};
    for (const property of node.getProperties()) {
      if (!Node.isPropertyAssignment(property)) {
        throw new LocatorExpressionError(`unsupported object property: ${property.getText()}`);
      }
      const nameNode = property.getNameNode();
      const key = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
      out[key] = toValue(property.getInitializerOrThrow(), allowLocators);
    }
    return out;
  }
  if (allowLocators && Node.isCallExpression(node) && isLocatorChain(node)) {
    return new LocatorRef({ text: normaliseLocatorText(node.getText()), calls: parseChain(node) });
  }
  throw new LocatorExpressionError(`unsupported argument: ${node.getText()}`);
}

function materialise(page: Page, arg: LocatorArg): unknown {
  if (arg instanceof LocatorRef) return buildLocator(page, arg.parsed);
  if (Array.isArray(arg)) return arg.map((item) => materialise(page, item));
  if (arg !== null && typeof arg === 'object' && !(arg instanceof RegExp)) {
    return Object.fromEntries(Object.entries(arg).map(([key, value]) => [key, materialise(page, value)]));
  }
  return arg;
}

/** Rebuild a parsed chain by calling the real Playwright methods. */
export function buildLocator(page: Page, parsed: ParsedLocator): Locator {
  let current: unknown = page;
  for (const call of parsed.calls) {
    const target = current as Record<string, unknown>;
    const method = target[call.method];
    if (typeof method !== 'function') {
      throw new LocatorExpressionError(`\`${call.method}()\` is not available here`);
    }
    current = (method as (...args: unknown[]) => unknown).apply(
      current,
      call.args.map((arg) => materialise(page, arg)),
    );
  }
  if (current === page) throw new LocatorExpressionError('empty locator chain');
  return current as Locator;
}

const FORBIDDEN_SELECTORS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /:nth-(child|of-type|last-child|last-of-type)/, reason: 'uses a positional nth-child chain' },
  { pattern: /^(xpath=|\/\/|\.\.\/|\()/, reason: 'uses XPath' },
  { pattern: /\.(css|sc|jss|emotion|chakra|mui)-[A-Za-z0-9]{4,}/, reason: 'uses an auto-generated CSS-in-JS class name' },
  { pattern: /\.[A-Za-z0-9]+_[A-Za-z0-9-]+__[A-Za-z0-9]{5,}/, reason: 'uses a hashed CSS-module class name' },
  { pattern: /\.[a-z]{1,3}-?[0-9a-f]{6,}\b/, reason: 'uses a hashed class name' },
];

export type CandidateValidation = { ok: true; parsed: ParsedLocator } | { ok: false; reason: string };

/** Parse a candidate and reject brittle locator styles before touching the page. */
export function validateCandidate(text: string): CandidateValidation {
  let parsed: ParsedLocator;
  try {
    parsed = parseLocatorExpression(text);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  for (const call of parsed.calls) {
    if (POSITIONAL_METHODS.has(call.method)) {
      return { ok: false, reason: `uses positional \`${call.method}()\`` };
    }
    if (call.method === 'locator') {
      const selector = call.args[0];
      if (typeof selector !== 'string') return { ok: false, reason: 'locator() needs a string selector' };
      for (const rule of FORBIDDEN_SELECTORS) {
        if (rule.pattern.test(selector)) return { ok: false, reason: rule.reason };
      }
    }
  }
  return { ok: true, parsed };
}
