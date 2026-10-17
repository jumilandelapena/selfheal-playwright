import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJsonReport, type JsonReport } from '../../src/healer/runner.js';

const cwd = path.resolve('/repo');
const file = path.join(cwd, 'tests', 'login.spec.ts');

const report: JsonReport = {
  config: { rootDir: cwd },
  suites: [
    {
      title: 'login.spec.ts',
      specs: [],
      suites: [
        {
          title: 'login',
          specs: [
            {
              title: 'passes',
              file: 'tests/login.spec.ts',
              line: 3,
              tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
            },
            {
              title: 'fails with a location',
              file: 'tests/login.spec.ts',
              line: 8,
              tests: [
                {
                  status: 'unexpected',
                  results: [
                    {
                      status: 'failed',
                      errors: [
                        {
                          message: "TimeoutError: locator.click: Timeout 3000ms exceeded.\nCall log:\n  - waiting for locator('#login-btn')\n",
                          location: { file, line: 11, column: 38 },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              title: 'fails without a location',
              file: 'tests/login.spec.ts',
              line: 20,
              tests: [
                {
                  status: 'unexpected',
                  results: [
                    {
                      status: 'timedOut',
                      error: { message: `Error: expect(received).toBe(expected)\n\n    at ${file}:23:5\n` },
                    },
                  ],
                },
              ],
            },
            {
              title: 'is skipped',
              file: 'tests/login.spec.ts',
              line: 30,
              tests: [{ status: 'skipped', results: [{ status: 'skipped' }] }],
            },
            {
              title: 'fails inside a page object',
              file: 'tests/login.spec.ts',
              line: 40,
              tests: [
                {
                  status: 'unexpected',
                  results: [
                    {
                      status: 'failed',
                      errors: [
                        {
                          message: "TimeoutError: locator.click: Timeout 3000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Save' })\n",
                          location: { file: path.join(cwd, 'src', 'pages', 'LoginPage.ts'), line: 27, column: 9 },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('parseJsonReport', () => {
  it('collects passed ids and classified failures with locations', () => {
    const result = parseJsonReport(report, cwd, 'report.json');
    expect(result.total).toBe(5);
    expect(result.passed).toEqual(['tests/login.spec.ts::passes']);
    expect(result.failed).toHaveLength(3);

    const [withLocation, withoutLocation, inPageObject] = result.failed;
    expect(withLocation).toMatchObject({
      id: 'tests/login.spec.ts::fails with a location',
      relFile: 'tests/login.spec.ts',
      errorFile: file,
      titlePath: ['login', 'fails with a location'],
      specLine: 8,
      line: 11,
      column: 38,
    });
    expect(withLocation?.classification).toMatchObject({ kind: 'locator-timeout', healable: true });

    // No reporter location: fall back to the stack frame inside the spec file.
    expect(withoutLocation).toMatchObject({ line: 23, column: 5, errorFile: file });
    expect(withoutLocation?.classification.healable).toBe(false);

    // The error was thrown in a page object: the spec stays the test file, but the
    // error file and line point at the helper so the healer can refuse honestly.
    expect(inPageObject).toMatchObject({
      file,
      errorFile: path.join(cwd, 'src', 'pages', 'LoginPage.ts'),
      line: 27,
      column: 9,
    });
    expect(inPageObject?.classification.healable).toBe(true);
  });
});
