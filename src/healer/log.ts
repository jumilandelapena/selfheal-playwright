/** Minimal coloured logger. Colours are dropped when stdout is not a TTY. */

export interface Logger {
  info(message: string): void;
  step(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function paint(code: string, text: string): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const colors = {
  dim: (t: string) => paint('2', t),
  bold: (t: string) => paint('1', t),
  green: (t: string) => paint('32', t),
  yellow: (t: string) => paint('33', t),
  red: (t: string) => paint('31', t),
  cyan: (t: string) => paint('36', t),
};

export function createLogger(options: { verbose?: boolean; quiet?: boolean } = {}): Logger {
  const write = (line: string): void => {
    if (!options.quiet) process.stdout.write(`${line}\n`);
  };
  return {
    info: (m) => write(m),
    step: (m) => write(`${colors.cyan('▶')} ${m}`),
    success: (m) => write(`${colors.green('✓')} ${m}`),
    warn: (m) => write(`${colors.yellow('!')} ${m}`),
    error: (m) => process.stderr.write(`${colors.red('✗')} ${m}\n`),
    debug: (m) => {
      if (options.verbose) write(colors.dim(`  ${m}`));
    },
  };
}

export const silentLogger: Logger = {
  info: () => {},
  step: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
