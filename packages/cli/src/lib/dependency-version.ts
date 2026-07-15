import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { satisfies, subset, valid, validRange } from 'semver'

import { BYLINE_RELEASE_POLICY } from './release-policy.js'
import { resolveWorkspaceOwnership, workspacePackageDirectories } from './workspace-root.js'
import type { Context } from '../context.js'
import type { DepSpec } from '../manifest/deps.js'

const BARE_WORKSPACE_RANGES = new Set(['workspace:*', 'workspace:^', 'workspace:~'])
const resolvedVersions = new WeakMap<Context, Map<string, string | undefined>>()

export interface DependencyCompatibility {
  status: 'compatible' | 'incompatible' | 'unknown'
  preserveDeclared: boolean
  reason: string
  actualVersion?: string
}

export function evaluateDependencyCompatibility(
  ctx: Context,
  spec: DepSpec,
  declared: string
): DependencyCompatibility {
  const trimmed = declared.trim()
  const actualVersion = BARE_WORKSPACE_RANGES.has(trimmed)
    ? resolvePackageVersion(ctx, spec.name)
    : undefined
  return checkDependencyVersion(spec, declared, actualVersion)
}

export function checkDependencyVersion(
  spec: DepSpec,
  declared: string,
  actualVersion?: string
): DependencyCompatibility {
  if (spec.group !== 'byline') {
    return { status: 'compatible', preserveDeclared: false, reason: 'not a Byline package' }
  }

  const trimmed = declared.trim()
  if (BARE_WORKSPACE_RANGES.has(trimmed)) {
    if (!actualVersion) {
      return {
        status: 'unknown',
        preserveDeclared: true,
        reason: `${trimmed} target version could not be resolved locally`,
      }
    }
    if (!valid(actualVersion) || !satisfies(actualVersion, BYLINE_RELEASE_POLICY.supportedRange)) {
      return {
        status: 'incompatible',
        preserveDeclared: true,
        actualVersion,
        reason: `${trimmed} resolves to unsupported ${actualVersion}`,
      }
    }
    return {
      status: 'compatible',
      preserveDeclared: true,
      actualVersion,
      reason: `${trimmed} resolves to ${actualVersion}`,
    }
  }

  const range = normalizeStaticRange(spec, trimmed)
  if (!range) {
    return { status: 'incompatible', preserveDeclared: false, reason: 'invalid version range' }
  }
  try {
    const compatible =
      validRange(range) !== null && subset(range, BYLINE_RELEASE_POLICY.supportedRange)
    return compatible
      ? { status: 'compatible', preserveDeclared: trimmed.startsWith('workspace:'), reason: range }
      : {
          status: 'incompatible',
          preserveDeclared: trimmed.startsWith('workspace:'),
          reason: `${range} is not wholly within ${BYLINE_RELEASE_POLICY.supportedRange}`,
        }
  } catch {
    return { status: 'incompatible', preserveDeclared: false, reason: 'invalid version range' }
  }
}

export function isDependencyVersionCompatible(spec: DepSpec, declared: string): boolean {
  return checkDependencyVersion(spec, declared).status === 'compatible'
}

function normalizeStaticRange(spec: DepSpec, declared: string): string | null {
  if (declared.startsWith('workspace:')) return declared.slice('workspace:'.length)
  const npmAlias = declared.match(/^npm:(@byline\/[a-z0-9-]+)@(.+)$/)
  if (npmAlias) return npmAlias[1] === spec.name ? (npmAlias[2] ?? null) : null
  return declared || null
}

function resolvePackageVersion(ctx: Context, packageName: string): string | undefined {
  const cached = resolvedVersions.get(ctx)
  if (cached?.has(packageName)) return cached.get(packageName)

  let version: string | undefined
  const ownership = resolveWorkspaceOwnership(ctx.cwd)
  const matches: string[] = []
  for (const directory of workspacePackageDirectories(ownership)) {
    const candidate = readNamedPackageVersion(join(directory, 'package.json'), packageName)
    if (candidate) matches.push(candidate)
  }
  if (matches.length === 1) version = matches[0]
  const next = cached ?? new Map<string, string | undefined>()
  next.set(packageName, version)
  if (!cached) resolvedVersions.set(ctx, next)
  return version
}

function readNamedPackageVersion(path: string, packageName: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { name?: string; version?: string }
    return pkg.name === packageName && typeof pkg.version === 'string' ? pkg.version : undefined
  } catch {
    return undefined
  }
}
