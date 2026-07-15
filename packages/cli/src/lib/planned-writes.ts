import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { FileWrite } from '../types.js'

export interface ApplyWritesResult {
  written: string[]
  conflicts: string[]
}

/** Apply exactly the writes shown in a plan, unless a target changed after planning. */
export function applyPlannedWrites(writes: readonly FileWrite[]): ApplyWritesResult {
  const conflicts: string[] = []

  for (const write of writes) {
    const exists = existsSync(write.path)
    const current = exists ? readFileSync(write.path, 'utf8') : undefined
    if (write.mode === 'delete' && !exists) {
      conflicts.push(write.path)
      continue
    }
    if (write.mode === 'create' && exists) {
      conflicts.push(write.path)
      continue
    }
    if (write.before !== undefined && current !== write.before) {
      conflicts.push(write.path)
    }
  }

  // Never partially apply a stale plan: validate every snapshot first.
  if (conflicts.length > 0) return { written: [], conflicts }

  const written: string[] = []
  for (const write of writes) {
    if (write.mode === 'delete') {
      rmSync(write.path)
      written.push(write.path)
      continue
    }
    mkdirSync(dirname(write.path), { recursive: true })
    writeFileSync(write.path, write.contents, 'utf8')
    written.push(write.path)
  }

  return { written, conflicts }
}
