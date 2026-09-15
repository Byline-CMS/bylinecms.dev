/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineAdminConfig } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { abilityFingerprint, buildBylineFieldServices } from './byline-field-services.js'

// A deliberately non-default admin base: the create URL must come from host
// configuration, and a hardcoded `/admin` would pass against the usual value.
defineAdminConfig({
  i18n: {
    admin: { defaultLocale: 'en', locales: ['en'] },
    content: { defaultLocale: 'en', locales: ['en'] },
  },
  routes: { admin: '/control-panel' },
  collections: [
    {
      path: 'media',
      labels: { singular: 'Media', plural: 'Media' },
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
    },
  ],
  slugifier: (value: string) => value.toLowerCase().trim().replace(/\s+/g, '-'),
})

const viewer = (abilities: string[], isSuperAdmin = false) => ({
  is_super_admin: isSuperAdmin,
  abilities,
})

describe('ability fingerprint', () => {
  /**
   * The services object is a dependency of the relation picker's fetch effect.
   * Memoising it on the abilities *array* would rebuild it whenever the host
   * re-rendered with a fresh array, and the picker would refetch on every parent
   * render. The fingerprint is content-addressed so a new array with the same
   * abilities produces the same key.
   */
  it('is equal for a different array holding the same abilities', () => {
    const a = abilityFingerprint(viewer(['collections.media.create', 'collections.media.read']))
    const b = abilityFingerprint(viewer(['collections.media.create', 'collections.media.read']))

    expect(a).toBe(b)
  })

  it('changes when an ability is gained or lost', () => {
    const before = abilityFingerprint(viewer(['collections.media.read']))
    const after = abilityFingerprint(viewer(['collections.media.read', 'collections.media.create']))

    expect(after).not.toBe(before)
  })

  it('distinguishes a super-admin from a viewer holding the same listed abilities', () => {
    const plain = abilityFingerprint(viewer(['collections.media.create']))
    const superAdmin = abilityFingerprint(viewer(['collections.media.create'], true))

    expect(superAdmin).not.toBe(plain)
  })

  /**
   * Ability order is not meaningful and the server does not promise one, so an
   * order change must not invalidate the memo.
   */
  it('ignores the order abilities arrive in', () => {
    const one = abilityFingerprint(viewer(['a.read', 'b.create']))
    const other = abilityFingerprint(viewer(['b.create', 'a.read']))

    expect(one).toBe(other)
  })
})

describe('field services built for a viewer', () => {
  it('keeps the existing services intact', () => {
    const services = buildBylineFieldServices(viewer([]))

    expect(typeof services.getCollectionDocuments).toBe('function')
    expect(typeof services.uploadField).toBe('function')
    expect(typeof services.placeTreeNode).toBe('function')
    expect(typeof services.getTreeAncestors).toBe('function')
  })

  it('permits creation only for a collection the viewer may create in', () => {
    const services = buildBylineFieldServices(viewer(['collections.media.create']))

    expect(services.canCreateInCollection?.('media')).toBe(true)
    expect(services.canCreateInCollection?.('pages')).toBe(false)
  })

  /**
   * Mirrors `useAbility`, which short-circuits for super-admins rather than
   * enumerating their abilities.
   */
  it('permits creation anywhere for a super-admin', () => {
    const services = buildBylineFieldServices(viewer([], true))

    expect(services.canCreateInCollection?.('media')).toBe(true)
    expect(services.canCreateInCollection?.('anything')).toBe(true)
  })

  it('does not treat a read ability as permission to create', () => {
    const services = buildBylineFieldServices(viewer(['collections.media.read']))

    expect(services.canCreateInCollection?.('media')).toBe(false)
  })

  /**
   * Root-relative, from the host's configured admin path. Not absolute: no
   * origin is available during the server render, and the configured base may
   * not be `/admin`.
   */
  it('builds a root-relative create url from the configured admin path', () => {
    const services = buildBylineFieldServices(viewer([]))
    const url = services.getCreateDocumentUrl?.('media')

    expect(url).toBeTruthy()
    expect(url?.startsWith('/')).toBe(true)
    expect(url?.startsWith('//')).toBe(false)
    expect(url).toBe('/control-panel/collections/media/create')
  })
})
