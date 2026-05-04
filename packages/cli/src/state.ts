import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { InstallState, PhaseId } from './types.js'

const STATE_FILE = '.byline-install.json'

export class StateStore {
  private state: InstallState
  private readonly path: string
  private dirty = false

  constructor(cwd: string) {
    this.path = resolve(cwd, STATE_FILE)
    this.state = this.load() ?? this.fresh()
  }

  private fresh(): InstallState {
    return {
      version: 1,
      startedAt: new Date().toISOString(),
      completedPhases: [],
      answers: {},
      wireSubEdits: {},
    }
  }

  private load(): InstallState | null {
    if (!existsSync(this.path)) return null
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as InstallState
      if (raw.version !== 1) return null
      return raw
    } catch {
      return null
    }
  }

  get(): Readonly<InstallState> {
    return this.state
  }

  patch(partial: Partial<InstallState>): void {
    this.state = { ...this.state, ...partial }
    this.dirty = true
  }

  patchAnswers(partial: InstallState['answers']): void {
    this.state.answers = { ...this.state.answers, ...partial }
    this.dirty = true
  }

  markPhaseComplete(id: PhaseId): void {
    if (!this.state.completedPhases.includes(id)) {
      this.state.completedPhases.push(id)
      this.dirty = true
    }
  }

  isComplete(id: PhaseId): boolean {
    return this.state.completedPhases.includes(id)
  }

  setWireSubEdit(key: string, status: 'pending' | 'done' | 'manual' | 'skipped'): void {
    this.state.wireSubEdits[key] = status
    this.dirty = true
  }

  flush(): void {
    if (!this.dirty) return
    writeFileSync(this.path, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
    this.dirty = false
  }

  filePath(): string {
    return this.path
  }
}
