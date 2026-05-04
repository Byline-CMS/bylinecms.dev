import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Prompter } from './prompts.js'
import type { StateStore } from './state.js'
import type { PackageManager } from './types.js'
import type { Logger } from './ui/logger.js'

export interface ContextOptions {
  cwd: string
  apply: boolean
  dryRun: boolean
  yes: boolean
  reset: boolean
  resetConfirmed: boolean
  pm?: PackageManager
  cliFlags: Record<string, string | boolean | undefined>
  logger: Logger
  prompter: Prompter
  state: StateStore
}

export interface Secrets {
  dbPassword?: string
}

export class Context {
  readonly cwd: string
  readonly apply: boolean
  readonly dryRun: boolean
  readonly yes: boolean
  readonly reset: boolean
  readonly resetConfirmed: boolean
  pm: PackageManager
  readonly cliFlags: Record<string, string | boolean | undefined>
  readonly logger: Logger
  readonly prompter: Prompter
  readonly state: StateStore
  readonly secrets: Secrets = {}

  constructor(opts: ContextOptions) {
    this.cwd = opts.cwd
    this.apply = opts.apply
    this.dryRun = opts.dryRun
    this.yes = opts.yes
    this.reset = opts.reset
    this.resetConfirmed = opts.resetConfirmed
    this.pm = opts.pm ?? 'pnpm'
    this.cliFlags = opts.cliFlags
    this.logger = opts.logger
    this.prompter = opts.prompter
    this.state = opts.state
  }

  resolve(...parts: string[]): string {
    return resolve(this.cwd, ...parts)
  }

  templatesDir(): string {
    const here = dirname(fileURLToPath(import.meta.url))
    return resolve(here, './templates')
  }
}
