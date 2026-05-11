/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminAuth, RequestContext } from '@byline/auth'
import type { ZodType } from 'zod'

import { assertAdminActor, requireAdminActor } from './assert-admin-actor.js'

/**
 * `createCommand` — the wrapper that folds the four-step admin command
 * contract (validate → authorise → invoke → shape) into a single
 * declaration.
 *
 * Implements Phase 1 of `docs/CORE-COMPOSITION.md`. Today's scope is
 * `@byline/admin`-internal: it gates against admin actor identity using
 * the existing `assertAdminActor` / `requireAdminActor` helpers, which
 * inherit the super-admin bypass from `AdminAuth.assertAbility`.
 *
 * The `auth` slot is a discriminated union:
 *
 *   - `{ ability }`         — full admin gate. Requires an `AdminAuth`
 *                             actor holding the named ability. Maps to
 *                             `assertAdminActor`.
 *   - `{ authenticated }`   — identity gate only. Requires an `AdminAuth`
 *                             actor but does not assert any ability. Used
 *                             by self-service commands in `admin-account`
 *                             where the security property is "you may
 *                             only mutate your own row" and the target
 *                             id is sourced from `actor.id`.
 *
 * The handler receives an args object so it can cherry-pick what it
 * needs without positional ordering — `context` for downstream calls
 * that need the full request context, `input` (already Zod-parsed),
 * `deps` (typed by the module), and `actor` (already narrowed to
 * `AdminAuth` by the auth step).
 *
 * The returned command preserves today's `(context, input, deps) =>
 * Promise<Output>` signature so existing server-fn call sites keep
 * working without change.
 *
 * Collection-document operations (create / update / delete / status /
 * upload) are gated through a separate helper, `assertActorCanPerform`,
 * which fires inside the `document-lifecycle` service functions in
 * `@byline/core`. They do not flow through this wrapper today; if the
 * two enforcement paths ever converge, the `auth` discriminator can
 * grow a `collection` variant without breaking existing call sites.
 */

export type CreateCommandAuthSpec =
  | { readonly ability: string; readonly authenticated?: never }
  | { readonly authenticated: true; readonly ability?: never }

export interface CreateCommandHandlerArgs<TInput, TDeps> {
  readonly context: RequestContext
  readonly input: TInput
  readonly deps: TDeps
  readonly actor: AdminAuth
}

export interface CreateCommandSpec<TInput, TOutput, TDeps> {
  /**
   * Stable identifier for the command, used in error messages and
   * future telemetry (Phase 1 of `CORE-COMPOSITION.md` calls out
   * uniform logging as a downstream benefit of the wrapper).
   */
  readonly method: string
  readonly auth: CreateCommandAuthSpec
  readonly schemas: {
    readonly input: ZodType<TInput>
    readonly output: ZodType<TOutput>
  }
  readonly handler: (args: CreateCommandHandlerArgs<TInput, TDeps>) => Promise<TOutput> | TOutput
}

export type Command<_TInput, TOutput, TDeps> = (
  context: RequestContext | undefined,
  input: unknown,
  deps: TDeps
) => Promise<TOutput>

export function createCommand<TInput, TOutput, TDeps>(
  spec: CreateCommandSpec<TInput, TOutput, TDeps>
): Command<TInput, TOutput, TDeps> {
  return async function command(
    context: RequestContext | undefined,
    input: unknown,
    deps: TDeps
  ): Promise<TOutput> {
    const parsed = spec.schemas.input.parse(input ?? {}) as TInput
    const actor =
      spec.auth.ability !== undefined
        ? assertAdminActor(context, spec.auth.ability)
        : requireAdminActor(context, spec.method)
    // `context` is non-null after the auth step — both helpers throw
    // `ERR_UNAUTHENTICATED` when the request context is missing.
    const result = await spec.handler({
      context: context as RequestContext,
      input: parsed,
      deps,
      actor,
    })
    return spec.schemas.output.parse(result) as TOutput
  }
}
