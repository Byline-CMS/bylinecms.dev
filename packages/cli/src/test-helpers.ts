import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from './context.js'
import { StateStore } from './state.js'
import type { Prompter } from './prompts.js'
import type { Answers } from './types.js'
import type { Logger } from './ui/logger.js'

const noop = () => {}
const logger: Logger = { info: noop, warn: noop, error: noop, success: noop, step: noop, raw: noop }
const prompter: Prompter = {
  async text({ defaultValue }) {
    return defaultValue ?? ''
  },
  async password() {
    return 'password'
  },
  async select({ options }) {
    const first = options[0]
    if (!first) throw new Error('test prompt has no options')
    return first.value
  },
  async confirm({ defaultValue }) {
    return defaultValue ?? true
  },
  spinner: () => ({ start: noop, stop: noop }),
  intro: noop,
  outro: noop,
  note: noop,
  cancel(message): never {
    throw new Error(message)
  },
}

export function createTestContext(answers: Answers = {}): Context {
  const cwd = mkdtempSync(join(tmpdir(), 'byline-cli-test-'))
  return createTestContextAt(cwd, answers)
}

export function createTestContextAt(cwd: string, answers: Answers = {}): Context {
  const state = new StateStore(cwd)
  state.patchAnswers(answers)
  return new Context({
    cwd,
    apply: true,
    dryRun: false,
    yes: true,
    reset: false,
    resetConfirmed: false,
    cliFlags: {},
    logger,
    prompter,
    state,
  })
}
