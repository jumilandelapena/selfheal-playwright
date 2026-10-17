import { spawnSync } from 'node:child_process';

export class CommandError extends Error {
  override name = 'CommandError';
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`${command} failed (exit ${exitCode}): ${stderr.trim()}`);
  }
}

/** Run a command without a shell and return trimmed stdout. Throws on a non-zero exit. */
export function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (result.error) throw new CommandError(`${command} ${args.join(' ')}`, null, result.error.message);
  if (result.status !== 0) throw new CommandError(`${command} ${args.join(' ')}`, result.status, result.stderr ?? '');
  return (result.stdout ?? '').trim();
}

export function tryRun(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): string | undefined {
  try {
    return run(command, args, cwd, env);
  } catch {
    return undefined;
  }
}

export function commandExists(command: string, cwd: string): boolean {
  return tryRun(command, ['--version'], cwd) !== undefined;
}

export const git = {
  isRepo: (cwd: string): boolean => tryRun('git', ['rev-parse', '--is-inside-work-tree'], cwd) === 'true',
  currentBranch: (cwd: string): string | undefined => {
    const branch = tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    return branch && branch !== 'HEAD' ? branch : undefined;
  },
  shortSha: (cwd: string): string => tryRun('git', ['rev-parse', '--short=7', 'HEAD'], cwd) ?? 'nohead',
  hasIdentity: (cwd: string): boolean =>
    Boolean(tryRun('git', ['config', 'user.email'], cwd)) && Boolean(tryRun('git', ['config', 'user.name'], cwd)),
};
