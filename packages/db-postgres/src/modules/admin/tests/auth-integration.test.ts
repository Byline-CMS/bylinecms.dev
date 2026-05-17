/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminStore } from '@byline/admin'
import { seedSuperAdmin } from '@byline/admin/admin-users'
import { hashPassword, resolveActor, verifyPassword } from '@byline/admin/auth'
import { AdminAuth } from '@byline/auth'
import { eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  adminPermissions,
  adminRoleAdminUser,
  adminRoles,
  adminUsers,
} from '../../../database/schema/auth.js'
import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import { createAdminStore } from '../admin-store.js'
import type * as schema from '../../../database/schema/index.js'

// ---------------------------------------------------------------------------
// Track-and-clean fixtures
// ---------------------------------------------------------------------------
//
// Integration tests share the dev database with the running webapp, so
// blanket `DELETE FROM admin_users` wipes would take out whichever
// super-admin the developer signed in with. Instead, every admin-user
// and admin-role row a test creates flows through `createUser` or
// `createRole` helpers that push the new id into a per-suite tracking
// set. `afterEach` deletes only those ids; `ON DELETE CASCADE` on
// `adminPermissions`, `adminRoleAdminUser`, and `adminRefreshTokens`
// handles the dependent rows automatically.
//
// To guard against a crashed prior run leaving a stale row with a test
// email, the helpers pre-delete any existing row with the same email or
// machine_name before inserting. Keeps the suite re-runnable without
// manual cleanup.

let db: NodePgDatabase<typeof schema>
let store: AdminStore

const trackedUserIds = new Set<string>()
const trackedRoleIds = new Set<string>()

// Pure-JS argon2id takes ~1 s per hash; this suite makes ~20 users, only
// one of which is later verified against its plaintext (the
// getByEmailForSignIn test). Pre-compute one hash for the common-case
// password ('pw') and reuse it for every test that doesn't care about
// the actual hash value — saves ~20 s on every run.
const SHARED_PASSWORD = 'pw'
let SHARED_HASH = ''

function trackUser(id: string) {
  trackedUserIds.add(id)
}
function trackRole(id: string) {
  trackedRoleIds.add(id)
}

async function createUser(input: {
  email: string
  password: string
  given_name?: string | null
  is_enabled?: boolean
  is_super_admin?: boolean
}) {
  const email = input.email.toLowerCase()
  // Clear any stale row left by a crashed prior run.
  await db.delete(adminUsers).where(eq(adminUsers.email, email))
  // Reuse the pre-computed hash when the password is the shared marker;
  // tests that actually verify the plaintext (verifyPassword,
  // signInWithPassword) supply their own password and pay the real hash
  // cost.
  const password_hash =
    input.password === SHARED_PASSWORD ? SHARED_HASH : await hashPassword(input.password)
  const row = await store.adminUsers.create({
    email: input.email,
    password_hash,
    given_name: input.given_name,
    is_enabled: input.is_enabled,
    is_super_admin: input.is_super_admin,
  })
  trackUser(row.id)
  return row
}

async function createRole(input: {
  name: string
  machine_name: string
  description?: string | null
  order?: number
}) {
  await db.delete(adminRoles).where(eq(adminRoles.machine_name, input.machine_name))
  const row = await store.adminRoles.create(input)
  trackRole(row.id)
  return row
}

async function cleanupTrackedRows() {
  if (trackedUserIds.size > 0) {
    await db.delete(adminUsers).where(inArray(adminUsers.id, [...trackedUserIds]))
  }
  if (trackedRoleIds.size > 0) {
    await db.delete(adminRoles).where(inArray(adminRoles.id, [...trackedRoleIds]))
  }
  trackedUserIds.clear()
  trackedRoleIds.clear()
}

// ---------------------------------------------------------------------------

describe('auth integration', () => {
  beforeAll(async () => {
    const testDB = setupTestDB([])
    db = testDB.db
    store = createAdminStore(db)
    SHARED_HASH = await hashPassword(SHARED_PASSWORD)
  })

  afterEach(async () => {
    await cleanupTrackedRows()
  })

  afterAll(async () => {
    await cleanupTrackedRows()
    await teardownTestDB()
  })

  // -------------------------------------------------------------------------
  // Admin users
  // -------------------------------------------------------------------------

  describe('admin users repository', () => {
    it('creates, reads, and hides the password hash from public rows', async () => {
      const created = await createUser({
        email: 'alice@example.com',
        password: 'alice-password',
        given_name: 'Alice',
      })
      expect(created.id).toBeTruthy()
      expect(created.email).toBe('alice@example.com')
      expect(created.given_name).toBe('Alice')
      expect(created.is_enabled).toBe(false) // default false
      expect(created.is_super_admin).toBe(false)
      // Public columns: password_hash is never returned
      expect((created as any).password_hash).toBe(undefined)

      const fetched = await store.adminUsers.getById(created.id)
      expect(fetched?.email).toBe('alice@example.com')
    })

    it('lowercases the email on insert and on lookup', async () => {
      await createUser({ email: 'Alice@Example.COM', password: 'pw' })
      const byMixed = await store.adminUsers.getByEmail('ALICE@example.com')
      expect(byMixed).toBeTruthy()
      expect(byMixed?.email).toBe('alice@example.com')
    })

    it('returns the password hash only via getByEmailForSignIn', async () => {
      await createUser({ email: 'b@example.com', password: 'pw-value' })

      const plain = await store.adminUsers.getByEmail('b@example.com')
      expect((plain as any)?.password_hash).toBe(undefined)

      const withPw = await store.adminUsers.getByEmailForSignIn('b@example.com')
      // `if !x throw` instead of `x!` so Biome's --unsafe rewrite (which
      // turns `!` into `?.`) doesn't reintroduce `string | undefined`
      // through verifyPassword's `hash: string` arg.
      if (!withPw) throw new Error('expected withPw to be defined')
      expect(await verifyPassword('pw-value', withPw.password_hash)).toBeTruthy()
    })

    it('update applies partial patches and bumps vid', async () => {
      const created = await createUser({ email: 'c@example.com', password: 'pw' })
      expect(created.vid).toBe(1)
      const updated = await store.adminUsers.update(created.id, created.vid, {
        given_name: 'Charlie',
        is_enabled: true,
      })
      expect(updated.given_name).toBe('Charlie')
      expect(updated.is_enabled).toBe(true)
      // Unchanged fields remain
      expect(updated.email).toBe('c@example.com')
      expect(updated.vid).toBe(created.vid + 1)
    })

    it('update throws VERSION_CONFLICT on a stale vid', async () => {
      const created = await createUser({ email: 'c2@example.com', password: 'pw' })
      // First update succeeds and bumps vid.
      await store.adminUsers.update(created.id, created.vid, { given_name: 'First' })
      // Replaying the same vid must conflict.
      await expect(() =>
        store.adminUsers.update(created.id, created.vid, { given_name: 'Second' })
      ).rejects.toMatchObject({ code: 'admin.users.versionConflict' })
    })

    it('setPasswordHash rehashes, bumps vid, and returns the fresh row', async () => {
      const created = await createUser({ email: 'd@example.com', password: 'old' })
      const updated = await store.adminUsers.setPasswordHash(
        created.id,
        created.vid,
        await hashPassword('new-password')
      )
      expect(updated.id).toBe(created.id)
      expect(updated.vid).toBe(created.vid + 1)

      const signIn = await store.adminUsers.getByEmailForSignIn('d@example.com')
      if (!signIn) throw new Error('expected signIn to be defined')
      expect(await verifyPassword('new-password', signIn.password_hash)).toBeTruthy()
      expect(await verifyPassword('old', signIn.password_hash)).toBe(false)
      expect(signIn.vid).toBe(created.vid + 1)
    })

    it('setPasswordHash throws VERSION_CONFLICT on a stale vid', async () => {
      const created = await createUser({ email: 'd2@example.com', password: 'pw' })
      await store.adminUsers.update(created.id, created.vid, { given_name: 'D' })
      await expect(() =>
        store.adminUsers.setPasswordHash(created.id, created.vid, '$argon2id$stale-hash')
      ).rejects.toMatchObject({ code: 'admin.users.versionConflict' })
    })

    it('recordLoginSuccess resets failed_login_attempts and stamps last_login', async () => {
      const created = await createUser({ email: 'e@example.com', password: 'pw' })
      await store.adminUsers.recordLoginFailure(created.id)
      await store.adminUsers.recordLoginFailure(created.id)
      let row = await store.adminUsers.getById(created.id)
      expect(row?.failed_login_attempts).toBe(2)

      await store.adminUsers.recordLoginSuccess(created.id, '10.0.0.1')
      row = await store.adminUsers.getById(created.id)
      expect(row?.failed_login_attempts).toBe(0)
      expect(row?.last_login_ip).toBe('10.0.0.1')
      expect(row?.last_login).toBeTruthy()
    })

    it('delete removes the row when vid matches', async () => {
      const created = await createUser({ email: 'f@example.com', password: 'pw' })
      await store.adminUsers.delete(created.id, created.vid)
      const fetched = await store.adminUsers.getById(created.id)
      expect(fetched).toBe(null)
    })

    it('delete throws VERSION_CONFLICT on a stale vid', async () => {
      const created = await createUser({ email: 'f2@example.com', password: 'pw' })
      await store.adminUsers.update(created.id, created.vid, { given_name: 'F' })
      await expect(() => store.adminUsers.delete(created.id, created.vid)).rejects.toMatchObject({
        code: 'admin.users.versionConflict',
      })
      // Row should still be present.
      expect(await store.adminUsers.getById(created.id)).toBeTruthy()
    })

    it('list applies pagination, order, and query filter', async () => {
      await createUser({ email: 'list1@example.com', password: 'pw', given_name: 'Aaron' })
      await createUser({ email: 'list2@example.com', password: 'pw', given_name: 'Bea' })
      await createUser({ email: 'list3@example.com', password: 'pw', given_name: 'Casey' })

      // Query filters against a stable, unique-to-this-test needle so
      // other test or dev rows don't skew the totals.
      const filtered = await store.adminUsers.list({
        page: 1,
        pageSize: 10,
        query: 'list',
        order: 'email',
        desc: false,
      })
      expect(filtered.length).toBe(3)

      const named = await store.adminUsers.list({
        page: 1,
        pageSize: 10,
        query: 'Bea',
        order: 'email',
        desc: false,
      })
      expect(named.length).toBe(1)
      expect(named[0]?.given_name).toBe('Bea')

      const total = await store.adminUsers.count({ query: 'list' })
      expect(total).toBe(3)
    })
  })

  // -------------------------------------------------------------------------
  // Admin roles + assignments
  // -------------------------------------------------------------------------

  describe('admin roles repository', () => {
    it('creates and reads a role', async () => {
      const role = await createRole({
        name: 'Editor',
        machine_name: 'test-editor',
        description: 'Can edit content',
      })
      expect(role.machine_name).toBe('test-editor')
      const byMachine = await store.adminRoles.getByMachineName('test-editor')
      expect(byMachine?.id).toBe(role.id)
    })

    it('assignToUser is idempotent and listRolesForUser returns the role', async () => {
      const user = await createUser({ email: 'g@example.com', password: 'pw' })
      const role = await createRole({ name: 'test-r', machine_name: 'test-r' })

      await store.adminRoles.assignToUser(role.id, user.id)
      await store.adminRoles.assignToUser(role.id, user.id) // idempotent

      const userRoles = await store.adminRoles.listRolesForUser(user.id)
      expect(userRoles.length).toBe(1)
      expect(userRoles[0]?.machine_name).toBe('test-r')

      const usersForRole = await store.adminRoles.listUsersForRole(role.id)
      expect(usersForRole).toEqual([user.id])
    })

    it('unassignFromUser removes the assignment', async () => {
      const user = await createUser({ email: 'h@example.com', password: 'pw' })
      const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
      await store.adminRoles.assignToUser(role.id, user.id)
      await store.adminRoles.unassignFromUser(role.id, user.id)
      expect((await store.adminRoles.listRolesForUser(user.id)).length).toBe(0)
    })

    it('delete cascades to permissions and role-user assignments', async () => {
      const user = await createUser({ email: 'i@example.com', password: 'pw' })
      const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
      await store.adminPermissions.grantAbility(role.id, 'a.one')
      await store.adminRoles.assignToUser(role.id, user.id)

      await store.adminRoles.delete(role.id, role.vid)

      // The role is gone…
      expect(await store.adminRoles.getById(role.id)).toBe(null)
      // …and its grants are gone…
      const grantsForRole = await db
        .select()
        .from(adminPermissions)
        .where(eq(adminPermissions.admin_role_id, role.id))
      expect(grantsForRole.length).toBe(0)
      // …and no assignment for the role remains.
      const assignsForRole = await db
        .select()
        .from(adminRoleAdminUser)
        .where(eq(adminRoleAdminUser.admin_role_id, role.id))
      expect(assignsForRole.length).toBe(0)
      // The user still exists.
      expect(await store.adminUsers.getById(user.id)).toBeTruthy()
    })
  })

  // -------------------------------------------------------------------------
  // Admin permissions
  // -------------------------------------------------------------------------

  describe('admin permissions repository', () => {
    it('grantAbility is idempotent', async () => {
      const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
      await store.adminPermissions.grantAbility(role.id, 'collections.pages.publish')
      await store.adminPermissions.grantAbility(role.id, 'collections.pages.publish')
      const abilities = await store.adminPermissions.listAbilities(role.id)
      expect(abilities).toEqual(['collections.pages.publish'])
    })

    it('revokeAbility removes the grant', async () => {
      const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
      await store.adminPermissions.grantAbility(role.id, 'a.one')
      await store.adminPermissions.grantAbility(role.id, 'a.two')
      await store.adminPermissions.revokeAbility(role.id, 'a.one')
      const abilities = await store.adminPermissions.listAbilities(role.id)
      expect(abilities.sort()).toEqual(['a.two'])
    })

    it('setAbilities replaces the ability set wholesale', async () => {
      const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
      await store.adminPermissions.grantAbility(role.id, 'a.one')
      await store.adminPermissions.grantAbility(role.id, 'a.two')
      await store.adminPermissions.setAbilities(role.id, ['a.three', 'a.four'])
      const abilities = await store.adminPermissions.listAbilities(role.id)
      expect(abilities.sort()).toEqual(['a.four', 'a.three'])
    })
  })

  // -------------------------------------------------------------------------
  // resolveActor
  // -------------------------------------------------------------------------

  describe('resolveActor', () => {
    it('returns null for unknown user ids', async () => {
      const actor = await resolveActor(store, '00000000-0000-7000-8000-000000000000')
      expect(actor).toBe(null)
    })

    it('returns null for disabled users', async () => {
      const user = await createUser({ email: 'j@example.com', password: 'pw' })
      // Created with is_enabled: false by default
      const actor = await resolveActor(store, user.id)
      expect(actor).toBe(null)
    })

    it('builds an AdminAuth with the union of abilities across roles', async () => {
      const user = await createUser({
        email: 'k@example.com',
        password: 'pw',
        is_enabled: true,
      })
      const roleA = await createRole({ name: 'A', machine_name: 'test-a' })
      const roleB = await createRole({ name: 'B', machine_name: 'test-b' })

      await store.adminPermissions.grantAbility(roleA.id, 'collections.pages.read')
      await store.adminPermissions.grantAbility(roleA.id, 'collections.pages.update')
      // Duplicate across roles — should collapse.
      await store.adminPermissions.grantAbility(roleB.id, 'collections.pages.update')
      await store.adminPermissions.grantAbility(roleB.id, 'collections.pages.publish')

      await store.adminRoles.assignToUser(roleA.id, user.id)
      await store.adminRoles.assignToUser(roleB.id, user.id)

      const actor = await resolveActor(store, user.id)
      expect(actor instanceof AdminAuth).toBeTruthy()
      expect(actor?.id).toBe(user.id)
      expect(actor?.isSuperAdmin).toBe(false)

      expect(actor?.hasAbility('collections.pages.read')).toBe(true)
      expect(actor?.hasAbility('collections.pages.update')).toBe(true)
      expect(actor?.hasAbility('collections.pages.publish')).toBe(true)
      expect(actor?.hasAbility('collections.pages.delete')).toBe(false)

      // Distinct — duplicates across roles collapse
      expect(actor?.abilities.size).toBe(3)
    })

    it('honours the is_super_admin flag', async () => {
      const user = await createUser({
        email: 'test-root@example.com',
        password: 'pw',
        is_super_admin: true,
        is_enabled: true,
      })
      const actor = await resolveActor(store, user.id)
      expect(actor).toBeTruthy()
      expect(actor?.isSuperAdmin).toBe(true)
      // Even without granting any abilities, super-admins pass every check
      expect(actor?.hasAbility('anything.at.all')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // seedSuperAdmin
  //
  // These tests use a test-specific role machine_name and email so the
  // idempotency assertions are not affected by (and do not affect) a
  // real dev-environment super-admin seed.
  // -------------------------------------------------------------------------

  describe('seedSuperAdmin', () => {
    const seedInput = {
      email: 'test-seed-super@example.com',
      password: 'initial-password',
      roleMachineName: 'test-seed-super-admin',
      roleName: 'Test Seed Super Admin',
    }

    it('creates role + user + assignment on first run', async () => {
      // Pre-clean in case a prior run left the seed in place.
      await db.delete(adminUsers).where(eq(adminUsers.email, seedInput.email))
      await db.delete(adminRoles).where(eq(adminRoles.machine_name, seedInput.roleMachineName))

      const result = await seedSuperAdmin(store, seedInput)
      trackUser(result.userId)
      trackRole(result.roleId)

      expect(result.userId).toBeTruthy()
      expect(result.roleId).toBeTruthy()
      expect(result.created).toEqual({ user: true, role: true, assignment: true })

      const actor = await resolveActor(store, result.userId)
      expect(actor).toBeTruthy()
      expect(actor?.isSuperAdmin).toBe(true)
    })

    it('is idempotent — second run reports nothing newly created', async () => {
      await db.delete(adminUsers).where(eq(adminUsers.email, seedInput.email))
      await db.delete(adminRoles).where(eq(adminRoles.machine_name, seedInput.roleMachineName))

      const first = await seedSuperAdmin(store, seedInput)
      trackUser(first.userId)
      trackRole(first.roleId)

      const second = await seedSuperAdmin(store, seedInput)
      expect(second.created).toEqual({
        user: false,
        role: false,
        assignment: false,
      })
    })
  })
})
