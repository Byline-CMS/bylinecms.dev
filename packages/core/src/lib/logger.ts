/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Structured logging for Byline CMS.
 *
 * Pino-based logger with AsyncLocalStorage context propagation, following
 * the same pattern as the Modulus project. Call-site context (domain, module,
 * class, function) is merged into every log entry as flat JSON fields.
 *
 * Primary access is via the typed Registry (see core.ts). A globalThis
 * singleton (defineLogger / getLogger) provides a backward-compat escape
 * hatch for code outside the DI graph (e.g. API route handlers).
 */

import { AsyncLocalStorage } from 'node:async_hooks'

import type {
  Level as PinoLevel,
  LevelWithSilent as PinoLevelWithSilent,
  Logger as PinoLogger,
} from 'pino'

// ---------------------------------------------------------------------------
// Log context — stored in AsyncLocalStorage
// ---------------------------------------------------------------------------

export interface LogContext {
  domain?: string
  module?: string
  class?: string
  function?: string
}

const logContextStore = new AsyncLocalStorage<LogContext>()
export const getLogContext = () => logContextStore.getStore() ?? {}
export const withLogContext = <T>(context: LogContext, fn: () => T): T => {
  return logContextStore.run({ ...getLogContext(), ...context }, fn)
}

// ---------------------------------------------------------------------------
// Logger types and interface
// ---------------------------------------------------------------------------

export type LogLevel = PinoLevel
export type LogLevelWithSilent = PinoLevelWithSilent

export type LogData = Record<string, unknown>

type LogFnArgs =
  | [message: string, ...args: unknown[]]
  | [data: LogData, message?: string, ...args: unknown[]]

export interface BylineLogger {
  log(level: LogLevel, ...args: LogFnArgs): void
  fatal(...args: LogFnArgs): void
  error(...args: LogFnArgs): void
  warn(...args: LogFnArgs): void
  info(...args: LogFnArgs): void
  debug(...args: LogFnArgs): void
  trace(...args: LogFnArgs): void
  silent(...args: LogFnArgs): void
}

// ---------------------------------------------------------------------------
// Factory — registry-compatible signature
// ---------------------------------------------------------------------------

export const createBylineLogger = (deps: { pinoLogger: PinoLogger }): BylineLogger => {
  return new BylineLoggerImpl(deps.pinoLogger)
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class BylineLoggerImpl implements BylineLogger {
  constructor(private pinoLogger: PinoLogger) {}

  log(level: LogLevel, ...[first, second, ...rest]: LogFnArgs): void {
    if (typeof first === 'string') {
      // args have shape [string, ...unknown[]]
      this.pinoLogger[level](getLogContext(), first, second, ...rest)
    } else {
      // Treat err field specially if present. Other values, if present, go
      // into extra.
      const { err, ...data } = first
      const extra = Object.keys(data).length > 0 ? data : undefined
      if (typeof second === 'string') {
        // args have shape [LogData, string, ...unknown[]]
        this.pinoLogger[level]({ ...getLogContext(), extra, err }, second, ...rest)
      } else {
        // args have shape [LogData]
        this.pinoLogger[level]({ ...getLogContext(), extra, err })
      }
    }
  }

  fatal(...args: LogFnArgs): void {
    this.log('fatal', ...args)
  }

  error(...args: LogFnArgs): void {
    this.log('error', ...args)
  }

  warn(...args: LogFnArgs): void {
    this.log('warn', ...args)
  }

  info(...args: LogFnArgs): void {
    this.log('info', ...args)
  }

  debug(...args: LogFnArgs): void {
    this.log('debug', ...args)
  }

  trace(...args: LogFnArgs): void {
    this.log('trace', ...args)
  }

  silent(..._args: LogFnArgs): void {}
}

// ---------------------------------------------------------------------------
// Global escape hatch — same pattern as defineServerConfig / getServerConfig
// ---------------------------------------------------------------------------

const BYLINE_LOGGER = Symbol.for('__byline_logger__')

export function defineLogger(logger: BylineLogger) {
  ;(globalThis as any)[BYLINE_LOGGER] = logger
}

export function getLogger(): BylineLogger {
  const logger = (globalThis as any)[BYLINE_LOGGER] as BylineLogger | undefined
  if (logger == null) {
    throw new Error(
      'Byline logger has not been initialized. Ensure initBylineCore() has been called.'
    )
  }
  return logger
}
