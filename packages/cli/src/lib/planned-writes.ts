import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { FileWrite } from '../types.js'

export interface ApplyWritesResult {
  written: string[]
  conflicts: string[]
}

/** Apply exactly the writes shown in a plan, unless a target changed after planning. */
export function applyPlannedWrites(writes: readonly FileWrite[]): ApplyWritesResult {
  const conflicts: string[] = []
  const normalizedPaths = writes.map((write) => resolve(write.path))

  for (let index = 0; index < normalizedPaths.length; index++) {
    const path = normalizedPaths[index]
    if (!path) continue
    for (let otherIndex = index + 1; otherIndex < normalizedPaths.length; otherIndex++) {
      const other = normalizedPaths[otherIndex]
      if (!other) continue
      if (path === other || isDescendant(path, other) || isDescendant(other, path)) {
        conflicts.push(path, other)
      }
    }
  }

  for (const write of writes) {
    const invalidParent = firstInvalidParent(write.path)
    if (invalidParent) {
      conflicts.push(invalidParent)
      continue
    }
    const target = lstatIfPresent(write.path)
    const exists = target !== undefined
    if (target && !target.isFile()) {
      conflicts.push(write.path)
      continue
    }
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
  if (conflicts.length > 0) return { written: [], conflicts: [...new Set(conflicts)] }

  const stageRoot = mkdtempSync(join(tmpdir(), 'byline-planned-writes-'))
  const staged = new Map<FileWrite, string>()
  try {
    for (const [index, write] of writes.entries()) {
      if (write.mode === 'delete') continue
      const path = join(stageRoot, String(index))
      writeFileSync(path, write.contents, 'utf8')
      staged.set(write, path)
    }
  } catch {
    rmSync(stageRoot, { recursive: true, force: true })
    return { written: [], conflicts: writes.map((write) => write.path) }
  }

  const written: string[] = []
  const applied: Array<{ path: string; before?: string }> = []
  const createdDirectories = new Set<string>()
  let failedPath: string | undefined
  try {
    for (const write of writes) {
      failedPath = write.path
      const invalidParent = firstInvalidParent(write.path)
      if (invalidParent) throw new Error(`invalid parent ${invalidParent}`)
      const target = lstatIfPresent(write.path)
      if (target && !target.isFile()) throw new Error(`non-file target ${write.path}`)
      if (write.mode === 'create' && target) throw new Error(`existing target ${write.path}`)
      if (write.mode === 'delete' && !target) throw new Error(`missing target ${write.path}`)
      const before = target ? readFileSync(write.path, 'utf8') : undefined
      if (write.before !== undefined && before !== write.before) {
        throw new Error(`stale target ${write.path}`)
      }
      applied.push({ path: write.path, before })
      if (write.mode === 'delete') {
        rmSync(write.path)
        written.push(write.path)
        continue
      }
      createParentDirectories(write.path, createdDirectories)
      const stagePath = staged.get(write)
      if (!stagePath) throw new Error(`missing staged contents for ${write.path}`)
      const contents = readFileSync(stagePath, 'utf8')
      if (write.mode === 'create')
        writeFileSync(write.path, contents, { encoding: 'utf8', flag: 'wx' })
      else writeFileSync(write.path, contents, 'utf8')
      written.push(write.path)
    }
  } catch {
    rollbackAppliedWrites(applied)
    removeCreatedDirectories(createdDirectories)
    return { written: [], conflicts: failedPath ? [failedPath] : writes.map((write) => write.path) }
  } finally {
    rmSync(stageRoot, { recursive: true, force: true })
  }

  return { written, conflicts }
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw error
  }
}

function isDescendant(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function firstInvalidParent(path: string): string | undefined {
  let parent = dirname(resolve(path))
  while (true) {
    const target = lstatIfPresent(parent)
    if (target) return target.isDirectory() ? undefined : parent
    const next = dirname(parent)
    if (next === parent) return parent
    parent = next
  }
}

function createParentDirectories(path: string, created: Set<string>): void {
  const missing: string[] = []
  let parent = dirname(resolve(path))
  while (!existsSync(parent)) {
    missing.push(parent)
    parent = dirname(parent)
  }
  for (const directory of missing.reverse()) {
    mkdirSync(directory)
    created.add(directory)
  }
}

function rollbackAppliedWrites(applied: readonly { path: string; before?: string }[]): void {
  for (const entry of [...applied].reverse()) {
    try {
      if (entry.before === undefined) rmSync(entry.path, { force: true })
      else {
        mkdirSync(dirname(entry.path), { recursive: true })
        writeFileSync(entry.path, entry.before, 'utf8')
      }
    } catch {
      // Continue restoring independent paths after a rollback failure.
    }
  }
}

function removeCreatedDirectories(directories: ReadonlySet<string>): void {
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    try {
      rmdirSync(directory)
    } catch {
      // Keep non-empty directories, including any that another process used.
    }
  }
}
