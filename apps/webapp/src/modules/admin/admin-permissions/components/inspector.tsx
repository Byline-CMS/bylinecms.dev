'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Read-only abilities inspector — Phase 8 in AUTHN-AUTHZ-ANALYSIS.md.
 *
 * Top level: a collapsible group per ability source (collections.docs,
 * admin.users, etc.), each containing the abilities that group
 * registered. Group buckets and ordering come straight from the
 * `AbilityRegistry.byGroup()` shape (registration order preserved).
 *
 * Per-ability: an inline-expandable row showing the roles that grant
 * the ability and the distinct admin users who hold it transitively.
 * The matrix is fetched lazily on first expand and cached for the
 * lifetime of the page — the registry is small (~40 keys) but the
 * matrix queries are not free, and most visitors only inspect a few
 * keys.
 */

import { useState } from 'react'

import { Button, Container, LoaderRing, Section } from '@infonomic/uikit/react'
import cx from 'classnames'

import { whoHasAbility } from '../who-has'
import type {
  AbilityDescriptorResponse,
  AbilityGroupResponse,
  ListRegisteredAbilitiesResponse,
  WhoHasAbilityResponse,
} from '../index'

// --- helpers ---------------------------------------------------------------

function sourceBadgeIntent(source: AbilityDescriptorResponse['source']): string {
  // Cosmetic colour mapping — collections are by far the most common,
  // so they get the neutral tone. Admin abilities pop slightly so the
  // inspector visually separates platform abilities from data ones.
  switch (source) {
    case 'collection':
      return 'bg-gray-100 text-gray-800 dark:bg-canvas-700 dark:text-gray-200'
    case 'admin':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
    case 'plugin':
      return 'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200'
    case 'core':
      return 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-200'
    default:
      return 'bg-gray-50 text-gray-600 dark:bg-canvas-800 dark:text-gray-400'
  }
}

function displayUser(user: WhoHasAbilityResponse['users'][number]): string {
  const parts = [user.given_name, user.family_name].filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  )
  return parts.length > 0 ? `${parts.join(' ')} (${user.email})` : user.email
}

// --- expandable matrix row ------------------------------------------------

function MatrixPanel({ matrix }: { matrix: WhoHasAbilityResponse }) {
  return (
    <div className="mt-2 grid gap-3 rounded-sm border border-gray-100 bg-canvas-25 p-3 dark:border-gray-700 dark:bg-canvas-800 sm:grid-cols-2">
      <div>
        <h4 className="!m-0 mb-2 text-sm font-bold">Roles ({matrix.roles.length})</h4>
        {matrix.roles.length === 0 ? (
          <p className="muted m-0 italic text-sm">No role grants this ability.</p>
        ) : (
          <ul className="m-0 list-none p-0 text-sm">
            {matrix.roles.map((role) => (
              <li key={role.id} className="mb-1">
                <span className="font-medium">{role.name}</span>
                <span className="muted">&nbsp;·&nbsp;{role.machine_name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="!m-0 mb-2 text-sm font-bold">Admin users ({matrix.users.length})</h4>
        {matrix.users.length === 0 ? (
          <p className="muted m-0 italic text-sm">No admin user holds this ability.</p>
        ) : (
          <ul className="m-0 list-none p-0 text-sm">
            {matrix.users.map((user) => (
              <li key={user.id} className="mb-1">
                {displayUser(user)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

interface AbilityRowProps {
  ability: AbilityDescriptorResponse
  matrix: WhoHasAbilityResponse | undefined
  loading: boolean
  onToggle: () => void
  expanded: boolean
}

function AbilityRow({ ability, matrix, loading, onToggle, expanded }: AbilityRowProps) {
  return (
    <div className="border-t border-gray-100 py-2 first:border-t-0 dark:border-gray-700">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <code className="rounded-sm bg-gray-50 px-1.5 py-0.5 text-xs dark:bg-canvas-800">
              {ability.key}
            </code>
            <span
              className={cx(
                'rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
                sourceBadgeIntent(ability.source)
              )}
            >
              {ability.source ?? 'unknown'}
            </span>
          </div>
          <p className="mb-0 mt-1 text-sm font-medium">{ability.label}</p>
          {ability.description ? <p className="muted mb-0 text-xs">{ability.description}</p> : null}
        </div>
        <Button size="sm" intent="secondary" onClick={onToggle}>
          {expanded ? 'Hide' : 'Holders'}
        </Button>
      </div>
      {expanded ? (
        loading ? (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <LoaderRing size={20} color="#888" />
            <span className="muted">Loading…</span>
          </div>
        ) : matrix ? (
          <MatrixPanel matrix={matrix} />
        ) : null
      ) : null}
    </div>
  )
}

// --- group section --------------------------------------------------------

interface GroupSectionProps {
  group: AbilityGroupResponse
  matrices: Record<string, WhoHasAbilityResponse>
  loading: Set<string>
  expanded: Set<string>
  onToggle: (abilityKey: string) => void
}

function GroupSection({ group, matrices, loading, expanded, onToggle }: GroupSectionProps) {
  return (
    <details
      open
      className="rounded-sm border border-gray-100 dark:border-gray-700 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer items-center justify-between p-3 list-none">
        <span className="font-medium">{group.group}</span>
        <span className="muted text-xs">{group.abilities.length} abilities</span>
      </summary>
      <div className="px-3 pb-3">
        {group.abilities.map((ability) => (
          <AbilityRow
            key={ability.key}
            ability={ability}
            matrix={matrices[ability.key]}
            loading={loading.has(ability.key)}
            expanded={expanded.has(ability.key)}
            onToggle={() => onToggle(ability.key)}
          />
        ))}
      </div>
    </details>
  )
}

// --- top level ------------------------------------------------------------

export function AbilitiesInspector({ data }: { data: ListRegisteredAbilitiesResponse }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [matrices, setMatrices] = useState<Record<string, WhoHasAbilityResponse>>({})

  async function handleToggle(abilityKey: string): Promise<void> {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(abilityKey)) {
        next.delete(abilityKey)
      } else {
        next.add(abilityKey)
      }
      return next
    })

    // Lazy-load the matrix the first time a row expands. Cached for
    // the lifetime of the page after that.
    if (!matrices[abilityKey] && !loading.has(abilityKey)) {
      setLoading((current) => new Set(current).add(abilityKey))
      try {
        const result = await whoHasAbility({ data: { ability: abilityKey } })
        setMatrices((current) => ({ ...current, [abilityKey]: result }))
      } finally {
        setLoading((current) => {
          const next = new Set(current)
          next.delete(abilityKey)
          return next
        })
      }
    }
  }

  return (
    <Section>
      <Container>
        <div className="mb-4 flex items-center gap-3">
          <h1 className="!m-0">Abilities Inspector</h1>
          <span className="rounded-sm border bg-gray-25 px-2 py-1 text-sm dark:bg-canvas-700">
            {data.total} registered
          </span>
        </div>
        <p className="muted mb-4 text-sm">
          Read-only view of every ability registered through <code>bylineCore.abilities</code>.
          Collections auto-register CRUD + workflow abilities; admin subsystems contribute their own
          keys at composition root via <code>registerAdminAbilities</code>.
        </p>
        {data.groups.length === 0 ? (
          <p className="muted">No abilities are registered.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.groups.map((group) => (
              <GroupSection
                key={group.group}
                group={group}
                matrices={matrices}
                loading={loading}
                expanded={expanded}
                onToggle={(key) => void handleToggle(key)}
              />
            ))}
          </div>
        )}
      </Container>
    </Section>
  )
}
