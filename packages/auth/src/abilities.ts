/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Ability registry.
 *
 * The load-bearing abstraction of Byline's authorization system.
 *
 * Every subsystem that wants to gate behaviour behind a permission
 * registers its abilities here at `initBylineCore()` time. The registry
 * feeds two consumers:
 *
 *   - **Runtime** — `AdminAuth.assertAbility('collections.pages.publish')`
 *     checks the flat ability set on the actor; the registry is intended
 *     to be consulted in dev mode to warn on unregistered keys once
 *     service-layer enforcement is wired in.
 *   - **Admin UI** — the role editor enumerates `list()` / `byGroup()`
 *     and renders a grouped checkbox tree. No per-plugin wiring.
 *
 * Collections auto-register their CRUD + workflow abilities via the
 * collection registrar in `@byline/core`. Future plugins (media,
 * uploads, settings) contribute their own groups.
 *
 * See docs/analysis/AUTHN-AUTHZ-ANALYSIS.md §3.
 */

/**
 * A single registered ability.
 *
 * `key` is the flat dotted string thrown against `AdminAuth.assertAbility`
 * and stored one-per-row in `admin_permissions`. Keep keys stable — they
 * are data-plane identifiers.
 *
 * `label` and `description` are UI-facing. `group` controls how the role
 * editor buckets the checkbox tree — collections typically use
 * `collections.<path>` so every ability for a collection lands in one
 * group.
 *
 * `source` tags the ability's origin for the inspector view (the
 * registered-collections / who-has-what panels still to ship).
 */
export interface AbilityDescriptor {
  /** Flat dotted string, e.g. `'collections.pages.publish'`. */
  key: string
  /** Short human-readable label for UI display. */
  label: string
  /** Group key for UI bucketing, e.g. `'collections.pages'` or `'media'`. */
  group: string
  /** Optional longer description, shown as tooltip / help text. */
  description?: string
  /** Where this ability was registered from. */
  source?: 'collection' | 'plugin' | 'core' | 'admin'
}

export class AbilityRegistry {
  readonly #abilities: Map<string, AbilityDescriptor> = new Map()

  /**
   * Register an ability. Silent no-op when the same key is re-registered
   * (dupe-tolerant so tests, hot-reload, and bootstrap re-runs don't need
   * to guard).
   */
  register(descriptor: AbilityDescriptor): void {
    if (this.#abilities.has(descriptor.key)) return
    this.#abilities.set(descriptor.key, { ...descriptor })
  }

  /** Whether a key has been registered. */
  has(key: string): boolean {
    return this.#abilities.has(key)
  }

  /** Look up a descriptor by key. */
  get(key: string): AbilityDescriptor | undefined {
    const found = this.#abilities.get(key)
    return found ? { ...found } : undefined
  }

  /** All registered abilities, in registration order. */
  list(): AbilityDescriptor[] {
    return Array.from(this.#abilities.values(), (d) => ({ ...d }))
  }

  /** All registered abilities grouped by their `group` key. */
  byGroup(): Map<string, AbilityDescriptor[]> {
    const buckets = new Map<string, AbilityDescriptor[]>()
    for (const descriptor of this.#abilities.values()) {
      const bucket = buckets.get(descriptor.group)
      const entry = { ...descriptor }
      if (bucket) bucket.push(entry)
      else buckets.set(descriptor.group, [entry])
    }
    return buckets
  }

  /** Number of registered abilities. */
  get size(): number {
    return this.#abilities.size
  }

  /** Drop every registered ability. Primarily for tests. */
  clear(): void {
    this.#abilities.clear()
  }
}
