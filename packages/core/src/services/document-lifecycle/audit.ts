/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Audit-log write helpers for the document-grain lifecycle write-points
 * (docs/AUDIT.md — Workstream 2). The audit log records the changes the
 * immutable version stream does NOT capture an actor for: non-versioned
 * system-field writes (path, available-locales), in-place status transitions,
 * and deletions. Each such mutation and its audit row commit atomically inside
 * `withTransaction` — a silently-unwritten audit row is the one unacceptable
 * outcome (see docs/TRANSACTIONS.md).
 */

import { ERR_AUDIT_UNSUPPORTED } from '../../lib/errors.js'
import { actorId } from './internals.js'
import type { AuditActorRealm, AuditLogAppendInput, IDbAdapter } from '../../@types/index.js'
import type { DocumentLifecycleContext } from './context.js'

/** Namespaced audit actions for document-grain changes. */
export const AUDIT_ACTIONS = {
  pathChanged: 'document.path.changed',
  localesChanged: 'document.locales.changed',
  statusChanged: 'document.status.changed',
  deleted: 'document.deleted',
} as const

/**
 * The actor id + realm for an audit-log row. Mirrors `actorId()`: a real
 * persisted user carries a UUID id and is recorded with realm `'admin'`
 * (these write-points are admin-gated, document-grain operations). A synthetic
 * script/seed actor (non-UUID) or no actor is a system/tooling write — NULL id,
 * realm `'system'`. (A future `UserAuth`-driven write-point would extend this
 * to `'user'`.)
 */
export function auditActor(ctx: DocumentLifecycleContext): {
  actorId: string | undefined
  actorRealm: AuditActorRealm
} {
  const id = actorId(ctx)
  return id != null
    ? { actorId: id, actorRealm: 'admin' }
    : { actorId: undefined, actorRealm: 'system' }
}

/** A non-null audit capability resolved from an adapter that supports it. */
export interface AuditCapability {
  withTransaction: <T>(fn: () => Promise<T>) => Promise<T>
  append: (input: AuditLogAppendInput) => Promise<{ id: string }>
}

/**
 * Assert the adapter can record an audited write atomically — it must provide
 * **both** `withTransaction` and `commands.audit`. Returns a non-null
 * capability the caller composes; throws `ERR_AUDIT_UNSUPPORTED` otherwise,
 * rather than silently skipping the audit row or running it non-atomically.
 * See docs/TRANSACTIONS.md and docs/AUDIT.md.
 */
export function requireAuditCapability(db: IDbAdapter): AuditCapability {
  const withTransaction = db.withTransaction
  const audit = db.commands.audit
  if (withTransaction == null || audit == null) {
    throw ERR_AUDIT_UNSUPPORTED({
      message: 'audited write requires a db adapter with withTransaction + commands.audit support',
    })
  }
  return {
    withTransaction: (fn) => withTransaction(fn),
    append: (input) => audit.append(input),
  }
}

/** Order-insensitive equality for the advertised-locale set. */
export function sameLocaleSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}
