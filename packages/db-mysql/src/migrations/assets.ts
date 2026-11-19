import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

export interface Stage {
  object: string
  add: string[]
  remove?: string[]
}

export interface MysqlStep {
  version: number
  name: string
  sha256: string
  classification: 'fenced' | 'online'
  compatible_from: number
  stages: Stage[]
  statements: string[]
  journal: string[]
}

const directory = new URL('../../migrations/', import.meta.url)

export function loadBaseline(): MysqlStep {
  const files = readdirSync(directory).sort()
  if (files.join(',') !== '0010_baseline.json,0010_baseline.sql')
    throw new Error('Unrecognized MySQL migration asset inventory')
  const evidence = readFileSync(new URL('0010_baseline.json', directory))
  if (
    createHash('sha256').update(evidence).digest('hex') !==
    'a81c67dcc67fbfc49b8a841cfe50f5c36b40b1810485778967303ed2d1c4688d'
  )
    throw new Error('MySQL 0010 catalog evidence failed its release checksum')
  const manifest = JSON.parse(evidence.toString('utf8')) as MysqlStep
  const bytes = readFileSync(new URL('0010_baseline.sql', directory))
  const statements = bytes
    .toString('utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
  if (
    manifest.version !== 10 ||
    manifest.name !== 'baseline' ||
    manifest.compatible_from !== 10 ||
    manifest.classification !== 'fenced' ||
    createHash('sha256').update(bytes).digest('hex') !== manifest.sha256 ||
    !manifest.journal?.length ||
    !manifest.stages?.length ||
    statements.length !== manifest.stages.length
  )
    throw new Error('Invalid MySQL baseline manifest or SQL digest')
  for (const [index, stage] of manifest.stages.entries()) {
    const ddl = statements[index] ?? ''
    const subject =
      ddl.match(/^(?:CREATE|ALTER) TABLE `(\w+)`/)?.[1] ??
      ddl.match(/^CREATE INDEX `\w+` ON `(\w+)`/)?.[1] ??
      ddl.match(/^CREATE ALGORITHM = undefined\s+SQL SECURITY definer\s+VIEW `(\w+)` AS/i)?.[1]
    if (
      subject !== stage.object ||
      !Array.isArray(stage.add) ||
      !stage.add.length ||
      !stage.add.every((v) => typeof v === 'string') ||
      stage.remove?.some((v) => typeof v !== 'string')
    )
      throw new Error(`Invalid MySQL baseline stage ${index + 1}`)
  }
  return { ...manifest, statements }
}

export function advance(current: string[], stage: Stage) {
  return [...current.filter((line) => !stage.remove?.includes(line)), ...stage.add].sort()
}

export function prefix(stages: Stage[], count: number) {
  const state = new Map<string, string[]>()
  for (const stage of stages.slice(0, count))
    state.set(stage.object, advance(state.get(stage.object) ?? [], stage))
  return state
}
