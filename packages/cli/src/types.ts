import type { Context } from './context.js'

export type PhaseId =
  | 'preflight'
  | 'prompts'
  | 'host'
  | 'db'
  | 'db-init'
  | 'env'
  | 'deps'
  | 'scaffold'
  | 'seed-admin'
  | 'seed-docs'
  | 'wire'
  | 'routes'
  | 'ui'
  | 'verify'

export type PhaseState = 'pending' | 'partial' | 'done' | 'blocked'

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export type DbStrategy = 'existing' | 'docker'

export interface FileWrite {
  path: string
  contents: string
  mode?: 'create' | 'overwrite' | 'patch'
  before?: string
}

export interface ShellCommand {
  command: string
  args: string[]
  cwd?: string
}

export interface Plan {
  writes: FileWrite[]
  commands: ShellCommand[]
  notes: string[]
}

export interface PhaseResult {
  state: PhaseState
  notes?: string[]
}

export interface Phase {
  id: PhaseId
  title: string
  defaultMode: 'confirm' | 'auto'
  detect(ctx: Context): Promise<PhaseState>
  plan(ctx: Context): Promise<Plan>
  apply(plan: Plan, ctx: Context): Promise<PhaseResult>
}

export interface Answers {
  dbStrategy?: DbStrategy
  dbHost?: string
  dbPort?: number
  dbName?: string
  dbUser?: string
  superuserUrl?: string
  adminPath?: string
  uiDir?: string
  examples?: boolean
  importDocs?: boolean
  pm?: PackageManager
  adminEmail?: string
}

export interface InstallState {
  version: 1
  startedAt: string
  completedPhases: PhaseId[]
  answers: Answers
  wireSubEdits: Record<string, 'pending' | 'done' | 'manual' | 'skipped'>
}
