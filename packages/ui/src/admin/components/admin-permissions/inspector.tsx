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
 *
 * Stable override handles: see `inspector.module.css`.
 */

import { useState } from 'react'

import type {
  AbilityDescriptorResponse,
  AbilityGroupResponse,
  ListRegisteredAbilitiesResponse,
  WhoHasAbilityResponse,
} from '@byline/admin/admin-permissions'
import { Button, Container, LoaderRing, Section } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './inspector.module.css'

// --- helpers ---------------------------------------------------------------

function sourceVariant(source: AbilityDescriptorResponse['source']) {
  switch (source) {
    case 'collection':
      return {
        global: 'byline-inspector-row-source-collection',
        local: styles['row-source-collection'],
      }
    case 'admin':
      return {
        global: 'byline-inspector-row-source-admin',
        local: styles['row-source-admin'],
      }
    case 'plugin':
      return {
        global: 'byline-inspector-row-source-plugin',
        local: styles['row-source-plugin'],
      }
    case 'core':
      return {
        global: 'byline-inspector-row-source-core',
        local: styles['row-source-core'],
      }
    default:
      return {
        global: 'byline-inspector-row-source-unknown',
        local: styles['row-source-unknown'],
      }
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
    <div className={cx('byline-inspector-matrix', styles.matrix)}>
      <div>
        <h4 className={cx('byline-inspector-matrix-title', styles['matrix-title'])}>
          Roles ({matrix.roles.length})
        </h4>
        {matrix.roles.length === 0 ? (
          <p className={cx('muted', 'byline-inspector-matrix-empty', styles['matrix-empty'])}>
            No role grants this ability.
          </p>
        ) : (
          <ul className={cx('byline-inspector-matrix-list', styles['matrix-list'])}>
            {matrix.roles.map((role) => (
              <li
                key={role.id}
                className={cx('byline-inspector-matrix-item', styles['matrix-item'])}
              >
                <span className={cx('byline-inspector-matrix-name', styles['matrix-name'])}>
                  {role.name}
                </span>
                <span className="muted">&nbsp;·&nbsp;{role.machine_name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className={cx('byline-inspector-matrix-title', styles['matrix-title'])}>
          Admin users ({matrix.users.length})
        </h4>
        {matrix.users.length === 0 ? (
          <p className={cx('muted', 'byline-inspector-matrix-empty', styles['matrix-empty'])}>
            No admin user holds this ability.
          </p>
        ) : (
          <ul className={cx('byline-inspector-matrix-list', styles['matrix-list'])}>
            {matrix.users.map((user) => (
              <li
                key={user.id}
                className={cx('byline-inspector-matrix-item', styles['matrix-item'])}
              >
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
  const sv = sourceVariant(ability.source)
  return (
    <div className={cx('byline-inspector-row', styles.row)}>
      <div className={cx('byline-inspector-row-head', styles['row-head'])}>
        <div className={cx('byline-inspector-row-info', styles['row-info'])}>
          <div className={cx('byline-inspector-row-meta', styles['row-meta'])}>
            <code className={cx('byline-inspector-row-key', styles['row-key'])}>{ability.key}</code>
            <span
              className={cx(
                'byline-inspector-row-source',
                styles['row-source'],
                sv.global,
                sv.local
              )}
            >
              {ability.source ?? 'unknown'}
            </span>
          </div>
          <p className={cx('byline-inspector-row-label', styles['row-label'])}>{ability.label}</p>
          {ability.description ? (
            <p
              className={cx('muted', 'byline-inspector-row-description', styles['row-description'])}
            >
              {ability.description}
            </p>
          ) : null}
        </div>
        <Button size="xs" intent="secondary" onClick={onToggle}>
          {expanded ? 'Hide' : 'Holders'}
        </Button>
      </div>
      {expanded ? (
        loading ? (
          <div className={cx('byline-inspector-loader', styles.loader)}>
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
    <details open className={cx('byline-inspector-group', styles.group)}>
      <summary className={cx('byline-inspector-group-summary', styles['group-summary'])}>
        <span className={cx('byline-inspector-group-name', styles['group-name'])}>
          {group.group}
        </span>
        <span className={cx('muted', 'byline-inspector-group-count', styles['group-count'])}>
          {group.abilities.length} abilities
        </span>
      </summary>
      <div className={cx('byline-inspector-group-body', styles['group-body'])}>
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
  const { whoHasAbility } = useBylineAdminServices()
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
        <div className={cx('byline-inspector-head', styles.head)}>
          <h1 className={cx('byline-inspector-title', styles.title)}>Abilities Inspector</h1>
          <span className={cx('byline-inspector-count-pill', styles['count-pill'])}>
            {data.total} registered
          </span>
        </div>
        <p className={cx('muted', 'byline-inspector-lead', styles.lead)}>
          Read-only view of every ability registered through <code>bylineCore.abilities</code>.
          Collections auto-register CRUD + workflow abilities; admin subsystems contribute their own
          keys at composition root via <code>registerAdminAbilities</code>.
        </p>
        {data.groups.length === 0 ? (
          <p className={cx('muted', 'byline-inspector-empty', styles.empty)}>
            No abilities are registered.
          </p>
        ) : (
          <div className={cx('byline-inspector-groups', styles.groups)}>
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
