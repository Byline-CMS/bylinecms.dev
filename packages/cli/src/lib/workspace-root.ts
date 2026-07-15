import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { Minimatch, minimatch } from 'minimatch'
import { parseDocument } from 'yaml'

import type { PackageManager } from '../types.js'

export interface WorkspaceOwnership {
  root: string
  kind: 'pnpm' | 'package-json' | 'standalone'
  patterns: string[]
}

export interface WorkspaceManagerConstraint {
  authoritative: boolean
  ambiguous: boolean
  manager?: PackageManager
  reason?: string
}

/** Resolve the nearest ancestor workspace that explicitly owns cwd. */
export function resolveWorkspaceOwnership(cwd: string): WorkspaceOwnership {
  const resolvedCwd = resolve(cwd)
  for (const directory of ancestors(resolvedCwd)) {
    const pnpmPath = join(directory, 'pnpm-workspace.yaml')
    if (existsSync(pnpmPath)) {
      const patterns = readPnpmWorkspacePatterns(pnpmPath)
      if (directory === resolvedCwd || matchesWorkspacePatterns(directory, resolvedCwd, patterns)) {
        return { root: directory, kind: 'pnpm', patterns }
      }
      // Declared pnpm package patterns are authoritative, including exclusions.
      // A settings-only legacy file has no ownership patterns, so a package.json
      // workspace at the same root may still own the app and can repair it.
      if (patterns.some((pattern) => !pattern.startsWith('!'))) continue
    }

    const patterns = readPackageWorkspacePatterns(join(directory, 'package.json'))
    if (
      patterns.length > 0 &&
      (directory === resolvedCwd || matchesWorkspacePatterns(directory, resolvedCwd, patterns))
    ) {
      return { root: directory, kind: 'package-json', patterns }
    }
  }
  return { root: resolvedCwd, kind: 'standalone', patterns: [] }
}

export function findWorkspaceRoot(cwd: string): string {
  return resolveWorkspaceOwnership(cwd).root
}

export function workspaceManagerConstraint(cwd: string): WorkspaceManagerConstraint {
  const ownership = resolveWorkspaceOwnership(cwd)
  if (ownership.kind === 'standalone') return { authoritative: false, ambiguous: false }

  const managers = new Set<PackageManager>()
  const unknown: string[] = []
  if (ownership.kind === 'pnpm') managers.add('pnpm')

  const packageManager = readPackageManager(join(ownership.root, 'package.json'))
  if (packageManager?.manager) managers.add(packageManager.manager)
  if (packageManager?.unknown) unknown.push(packageManager.unknown)

  const locks: Array<[string, PackageManager]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ]
  for (const [name, manager] of locks) {
    if (existsSync(join(ownership.root, name))) managers.add(manager)
  }

  if (unknown.length > 0 || managers.size > 1) {
    const found = [...managers, ...unknown].join(', ')
    return {
      authoritative: true,
      ambiguous: true,
      reason: `workspace package manager metadata conflicts (${found})`,
    }
  }
  const manager = [...managers][0]
  return manager
    ? { authoritative: true, ambiguous: false, manager }
    : { authoritative: false, ambiguous: false }
}

export function validateWorkspacePackageManager(
  cwd: string,
  selected: PackageManager
): { valid: true } | { valid: false; reason: string; expected?: PackageManager } {
  const constraint = workspaceManagerConstraint(cwd)
  if (constraint.ambiguous) {
    return { valid: false, reason: constraint.reason ?? 'workspace package manager is ambiguous' }
  }
  if (constraint.manager && constraint.manager !== selected) {
    return {
      valid: false,
      expected: constraint.manager,
      reason: `owning workspace uses ${constraint.manager}; use --pm ${constraint.manager}`,
    }
  }
  return { valid: true }
}

export function ancestors(cwd: string): string[] {
  const directories: string[] = []
  let current = resolve(cwd)
  while (true) {
    directories.push(current)
    const parent = dirname(current)
    if (parent === current) return directories
    current = parent
  }
}

export function matchesWorkspacePatterns(
  root: string,
  directory: string,
  patterns: string[]
): boolean {
  const candidate = relative(root, directory).replaceAll('\\', '/') || '.'
  const positive = patterns.filter((pattern) => !pattern.startsWith('!'))
  const negative = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => pattern.slice(1))
  return (
    positive.some((pattern) => minimatch(candidate, normalizePattern(pattern), MATCH_OPTIONS)) &&
    !negative.some((pattern) => minimatch(candidate, normalizePattern(pattern), MATCH_OPTIONS))
  )
}

/** Enumerate only package directories reachable through declared positive workspace patterns. */
export function workspacePackageDirectories(ownership: WorkspaceOwnership): string[] {
  if (ownership.kind === 'standalone') return []
  const directories = new Set<string>()
  for (const rawPattern of ownership.patterns) {
    if (rawPattern.startsWith('!')) continue
    const pattern = normalizePattern(rawPattern)
    const prefix = staticPatternPrefix(pattern)
    const start = resolve(ownership.root, prefix)
    if (!existsSync(start)) continue
    const patternDepth = pattern.includes('**')
      ? 8
      : pattern.split('/').length - (prefix ? prefix.split('/').length : 0)
    walkDeclaredRegion(start, ownership, directories, 0, patternDepth)
  }
  return [...directories].sort()
}

function walkDeclaredRegion(
  directory: string,
  ownership: WorkspaceOwnership,
  out: Set<string>,
  depth: number,
  maxDepth: number
): void {
  if (depth > maxDepth) return
  if (
    existsSync(join(directory, 'package.json')) &&
    matchesWorkspacePatterns(ownership.root, directory, ownership.patterns)
  ) {
    out.add(directory)
    return
  }
  if (depth === maxDepth) return
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const path = join(directory, entry)
    try {
      if (statSync(path).isDirectory()) {
        walkDeclaredRegion(path, ownership, out, depth + 1, maxDepth)
      }
    } catch {}
  }
}

function staticPatternPrefix(pattern: string): string {
  const parts: string[] = []
  for (const part of pattern.split('/')) {
    if (new Minimatch(part, MATCH_OPTIONS).hasMagic()) break
    parts.push(part)
  }
  return parts.join('/')
}

function readPnpmWorkspacePatterns(path: string): string[] {
  try {
    const doc = parseDocument(readFileSync(path, 'utf8'))
    if (doc.errors.length > 0) return []
    const packages = (doc.toJS() as { packages?: unknown } | null)?.packages
    return Array.isArray(packages)
      ? packages.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

function readPackageWorkspacePatterns(path: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
      workspaces?: string[] | { packages?: string[] }
    }
    if (Array.isArray(pkg.workspaces)) return pkg.workspaces
    return pkg.workspaces?.packages ?? []
  } catch {
    return []
  }
}

function readPackageManager(
  path: string
): { manager?: PackageManager; unknown?: string } | undefined {
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { packageManager?: string }
    if (!pkg.packageManager) return undefined
    const name = pkg.packageManager.split('@')[0]
    if (name === 'pnpm' || name === 'yarn' || name === 'npm' || name === 'bun') {
      return { manager: name }
    }
    return { unknown: pkg.packageManager }
  } catch {
    return undefined
  }
}

function normalizePattern(pattern: string): string {
  return pattern.replace(/^\.\//, '').replace(/\/$/, '')
}

const MATCH_OPTIONS = { dot: true, nocase: false } as const
