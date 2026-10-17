import type { Classification } from './types.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

const STRICT = /strict mode violation: (.+?) resolved to (\d+) elements/;
const ACTION_TIMEOUT = /(?:^|\n)(?:TimeoutError: )?locator\.(\w+): Timeout \d+ms exceeded/;
const EXPECT_HEADER = /(?:^|\n)(?:Error: )?expect\((locator|page|received)\)/;
const LOCATOR_LINE = /\nLocator:\s*(.+)/;
const WAITING_FOR = /\n\s*- waiting for (.+)/;
const RESOLVED_TO_ELEMENT = /locator resolved to (?!0 elements)/;

/**
 * Decide whether a Playwright failure is a broken locator (something the
 * agent may repair) or a genuine assertion failure (something it must not).
 *
 * The rules are deliberately conservative: when in doubt, do not heal.
 */
export function classifyFailure(rawMessage: string): Classification {
  const message = stripAnsi(rawMessage).replace(/\r\n/g, '\n');

  // 1. Strict-mode violation: the locator now matches several elements.
  const strict = STRICT.exec(message);
  if (strict) {
    return {
      kind: 'strict-mode',
      healable: true,
      locator: strict[1],
      reason: `locator resolved to ${strict[2]} elements`,
    };
  }

  // 2. Action timeout (click, fill, check, ...).
  const timeout = ACTION_TIMEOUT.exec(message);
  if (timeout) {
    if (RESOLVED_TO_ELEMENT.test(message)) {
      // The element was found but the action could not complete (disabled,
      // covered, detached). That is not a locator problem.
      return {
        kind: 'other',
        healable: false,
        locator: WAITING_FOR.exec(message)?.[1]?.trim(),
        reason: `locator.${timeout[1]} found the element but the action did not complete`,
      };
    }
    const waiting = WAITING_FOR.exec(message);
    if (waiting) {
      return {
        kind: 'locator-timeout',
        healable: true,
        locator: waiting[1]?.trim(),
        reason: `locator.${timeout[1]} timed out waiting for the element`,
      };
    }
    return { kind: 'other', healable: false, reason: `locator.${timeout[1]} timed out without a call log` };
  }

  // 3. Web-first assertions.
  const expectHeader = EXPECT_HEADER.exec(message);
  if (expectHeader) {
    const subject = expectHeader[1];
    if (subject !== 'locator') {
      return { kind: 'assertion', healable: false, reason: `expect(${subject}) failures are value checks` };
    }
    const locator = LOCATOR_LINE.exec(message)?.[1]?.trim();
    if (/Error: element\(s\) not found/.test(message)) {
      return {
        kind: 'element-not-found',
        healable: true,
        locator,
        reason: 'the asserted element was not found on the page',
      };
    }
    // Any "Received" value means the element existed and had the wrong state.
    return {
      kind: 'assertion',
      healable: false,
      locator,
      reason: 'the element was found but the asserted value did not match',
    };
  }

  // 4. Plain Jest-style assertions, navigation errors, thrown errors, ...
  if (/Timeout \d+ms exceeded/.test(message)) {
    return { kind: 'other', healable: false, reason: 'timeout outside a locator action' };
  }
  return { kind: 'other', healable: false, reason: 'not a locator failure' };
}
