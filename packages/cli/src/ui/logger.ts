import pc from 'picocolors'

export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
  success(msg: string): void
  step(msg: string): void
  raw(msg: string): void
}

export interface LoggerOptions {
  quiet?: boolean
  noColor?: boolean
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const c = opts.noColor
    ? {
        cyan: (s: string) => s,
        yellow: (s: string) => s,
        red: (s: string) => s,
        green: (s: string) => s,
        dim: (s: string) => s,
      }
    : pc

  return {
    info: (m) => {
      if (!opts.quiet) console.log(c.cyan('i'), m)
    },
    warn: (m) => console.log(c.yellow('!'), m),
    error: (m) => console.error(c.red('x'), m),
    success: (m) => {
      if (!opts.quiet) console.log(c.green('✓'), m)
    },
    step: (m) => {
      if (!opts.quiet) console.log(c.dim('→'), m)
    },
    raw: (m) => console.log(m),
  }
}
