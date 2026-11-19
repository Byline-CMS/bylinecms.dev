import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

export interface Stage {
  object: string
  add: string[]
  remove?: string[]
  data?: { before: string; after: string }
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
  online?: {
    server_versions: string[]
    tested_releases: Record<string, number>
    evidence: string
    lock_timeout_ms: number
    statement_timeout_ms: number
  }
}

const directory = new URL('../../migrations/', import.meta.url)

export function loadBaseline(): MysqlStep {
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

export function checkSuffix(step: MysqlStep, previous: MysqlStep) {
  if (
    step.version !== previous.version + 1 ||
    !step.stages.length ||
    step.stages.length !== step.statements.length
  )
    throw Error(`Noncontiguous or empty MySQL migration ${step.version}`)
  const proof = step.online
  if (step.classification === 'online') {
    if (
      !proof?.evidence?.trim() ||
      !Array.isArray(proof.server_versions) ||
      !proof.server_versions.length ||
      proof.server_versions.some((v) => !/^\d+\.\d+\.\d+$/.test(v)) ||
      proof.lock_timeout_ms % 1000 !== 0 ||
      !Number.isInteger(step.compatible_from) ||
      step.compatible_from < previous.compatible_from ||
      step.compatible_from >= step.version ||
      [proof.lock_timeout_ms, proof.statement_timeout_ms].some(
        (v) => !Number.isSafeInteger(v) || v < 1 || v > 2147483647
      ) ||
      !proof.tested_releases ||
      Object.entries(proof.tested_releases).some(
        ([key, value]) =>
          !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(key) ||
          !Number.isInteger(value) ||
          value < step.compatible_from ||
          value > step.version
      )
    )
      throw Error(`Missing MySQL online compatibility evidence for ${step.version}`)
    for (let v = step.compatible_from; v < step.version; v++)
      if (!Object.values(proof.tested_releases).includes(v))
        throw Error(`Untested MySQL contract ${v}`)
  } else if (step.classification !== 'fenced' || step.compatible_from !== step.version || proof)
    throw Error(`Invalid MySQL migration floor ${step.version}`)
  for (const [index, stage] of step.stages.entries()) {
    const sql = step.statements[index]!.trim().replace(/;$/, '')
    if (
      !/^byline_\w+$/.test(stage.object) ||
      stage.object === 'byline_core_migrations' ||
      /[;]|--|\/\*|#/.test(sql) ||
      !Array.isArray(stage.add) ||
      !stage.add.every((v) => typeof v === 'string') ||
      stage.remove?.some((v) => typeof v !== 'string')
    )
      throw Error(`Invalid MySQL stage ${index + 1}`)
    if (stage.data) {
      if (
        step.classification !== 'fenced' ||
        stage.add.length ||
        stage.remove?.length ||
        ![stage.data.before, stage.data.after].every(
          (q) => /^SELECT\s/i.test(q) && !/[;]|--|\/\*|#/.test(q)
        ) ||
        !new RegExp(`^(?:UPDATE|DELETE FROM|INSERT INTO) \`${stage.object}\`\\s`, 'i').test(sql)
      )
        throw Error(`Unsupported MySQL data stage ${index + 1}`)
    } else {
      if (
        !new RegExp(
          `^(?:(?:CREATE|ALTER) TABLE|(?:CREATE|ALTER) VIEW) \`${stage.object}\`\\s`,
          'i'
        ).test(sql) ||
        !(stage.add.length || stage.remove?.length)
      )
        throw Error(`Unsupported MySQL DDL stage ${index + 1}`)
      if (
        step.classification === 'online' &&
        (!/^ALTER TABLE /i.test(sql) ||
          !/,\s*ALGORITHM\s*=\s*(?:INPLACE\s*,\s*LOCK\s*=\s*NONE|INSTANT\s*,\s*LOCK\s*=\s*DEFAULT)\s*$/i.test(
            sql
          ))
      )
        throw Error('Online DDL requires an explicit nonblocking ALGORITHM and LOCK contract')
    }
  }
}

export function loadSteps(): MysqlStep[] {
  const files = readdirSync(directory).sort()
  const manifests = files.filter((f) => /^\d{4}_[a-z0-9_]+\.json$/.test(f))
  if (
    !manifests.length ||
    files.length !== manifests.length * 2 ||
    manifests[0] !== '0010_baseline.json'
  )
    throw Error('Invalid MySQL migration asset inventory')
  const steps = [loadBaseline()]
  for (const file of manifests.slice(1)) {
    const entry = JSON.parse(readFileSync(new URL(file, directory), 'utf8')) as MysqlStep
    const bytes = readFileSync(new URL(file.replace(/\.json$/, '.sql'), directory))
    if (
      file !== `${String(entry.version).padStart(4, '0')}_${entry.name}.json` ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sha256
    )
      throw Error(`Invalid MySQL migration digest ${file}`)
    const step = {
      ...entry,
      statements: bytes
        .toString()
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean),
    }
    checkSuffix(step, steps.at(-1)!)
    steps.push(step)
  }
  return steps
}
