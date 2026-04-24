/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import assert from 'node:assert'
import { after, afterEach, before, describe, it } from 'node:test'

import type { AdminStore } from '@byline/admin'
import { seedSuperAdmin } from '@byline/admin/admin-users'
import { hashPassword, resolveActor, verifyPassword } from '@byline/admin/auth'
import { AdminAuth } from '@byline/auth'
import { eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

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
  const password_hash = await hashPassword(input.password)
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
  before(() => {
    const testDB = setupTestDB([])
    db = testDB.db
    store = createAdminStore(db)
  })

  afterEach(async () => {
    await cleanupTrackedRows()
  })

  after(async () => {
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
      assert.ok(created.id)
      assert.strictEqual(created.email, 'alice@example.com')
      assert.strictEqual(created.given_name, 'Alice')
      assert.strictEqual(created.is_enabled, false) // default false
      assert.strictEqual(created.is_super_admin, false)
      // Public columns: password_hash is never returned
      assert.strictEqual((created as any).password_hash, undefined)

      const fetched = await store.adminUsers.getById(created.id)
      assert.strictEqual(fetched?.email, 'alice@example.com')
    })

    it('lowercases the email on insert and on lookup', async () => {
      await createUser({ email: 'Alice@Example.COM', password: 'pw' })
      const byMixed = await store.adminUsers.getByEmail('ALICE@example.com')
      assert.ok(byMixed)
      assert.strictEqual(byMixed.email, 'alice@example.com')
    })

    it('returns the password hash only via getByEmailForSignIn', async () => {
      await createUser({ email: 'b@example.com', password: 'pw-value' })

      const plain = await store.adminUsers.getByEmail('b@example.com')
      assert.strictEqual((plain as any)?.password_hash, undefined)

      const withPw = await store.adminUsers.getByEmailForSignIn('b@example.com')
      assert.ok(withPw)
      assert.ok(await verifyPassword('pw-value', withPw.password_hash))
    })

    it('update applies partial patches and bumps vid', async () => {
      const created = await createUser({ email: 'c@example.com', password: 'pw' })
      assert.strictEqual(created.vid, 1)
      const updated = await store.adminUsers.update(created.id, created.vid, {
        given_name: 'Charlie',
        is_enabled: true,
      })
      assert.strictEqual(updated.given_name, 'Charlie')
      assert.strictEqual(updated.is_enabled, true)
      // Unchanged fields remain
      assert.strictEqual(updated.email, 'c@example.com')
      assert.strictEqual(updated.vid, created.vid + 1)
    })

    it('update throws VERSION_CONFLICT on a stale vid', async () => {
      const created = await createUser({ email: 'c2@example.com', password: 'pw' })
      // First update succeeds and bumps vid.
      await store.adminUsers.update(created.id, created.vid, { given_name: 'First' })
      // Replaying the same vid must conflict.
      await assert.rejects(
        () => store.adminUsers.update(created.id, created.vid, { given_name: 'Second' }),
        (err: Error & { code?: string }) => err.code === 'admin.users.versionConflict'
      )
    })

    it('setPasswordHash rehashes, bumps vid, and returns the fresh row', async () => {
      const created = await createUser({ email: 'd@example.com', password: 'old' })
      const updated = await store.adminUsers.setPasswordHash(
        created.id,
        created.vid,
        await hashPassword('new-password')
      )
      assert.strictEqual(updated.id, created.id)
      assert.strictEqual(updated.vid, created.vid + 1)

      const signIn = await store.adminUsers.getByEmailForSignIn('d@example.com')
      assert.ok(signIn)
      assert.ok(await verifyPassword('new-password', signIn.password_hash))
      assert.strictEqual(await verifyPassword('old', signIn.password_hash), false)
      assert.strictEqual(signIn.vid, created.vid + 1)
    })

    it('setPasswordHash throws VERSION_CONFLICT on a stale vid', async () => {
      const created = await createUser({ email: 'd2@example.com', password: 'pw' })
      await store.adminUsers.update(created.id, created.vid, { given_name: 'D' })
      await assert.rejects(
        () => store.adminUsers.setPasswordHash(created.id, created.vid, '$argon2id$stale-hash'),
        (err: Error & { code?: string }) => err.code === 'admin.users.versionConflict'
      )
    })

    it('recordLoginSuccess resets failed_login_attempts and stamps last_login', async () => {
      const created = await createUser({ email: 'e@example.com', password: 'pw' })
      await store.adminUsers.recordLoginFailure(created.id)
      await store.adminUsers.recordLoginFailure(created.id)
      let row = await store.adminUsers.getById(created.id)
      assert.strictEqual(row?.failed_login_attempts, 2)

      await store.adminUsers.recordLoginSuccess(created.id, '10.0.0.1')
      row = await store.adminUsers.getById(created.id)
      assert.strictEqual(row?.failed_login_attempts, 0)
      assert.strictEqual(row?.last_login_ip, '10.0.0.1')
      assert.ok(row?.last_login)
    })

    it('delete removes the row when vid matches', async () => {
      const created = await createUser({ email: 'f@example.com', password: 'pw' })
      await store.adminUsers.delete(created.id, created.vid)
      const fetched = await store.adminUsers.getById(created.id)
      assert.strictEqual(fetched, null)
    })

    it('delete throws VERSION_CONFLICT on a stale vid', async () => {
      const created = await createUser({ email: 'f2@example.com', password: 'pw' })
      await store.adminUsers.update(created.id, created.vid, { given_name: 'F' })
      await assert.rejects(
        () => store.adminUsers.delete(created.id, created.vid),
        (err: Error & { code?: string }) => err.code === 'admin.users.versionConflict'
      )
      // Row should still be present.
      assert.ok(await store.adminUsers.getById(created.id))
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
      assert.strictEqual(filtered.length, 3)

      const named = await store.adminUsers.list({
        page: 1,
        pageSize: 10,
        query: 'Bea',
        order: 'email',
        desc: false,
      })
      assert.strictEqual(named.length, 1)
      assert.strictEqual(named[0]?.given_name, 'Bea')

      const total = await store.adminUsers.count({ query: 'list' })
      assert.strictEqual(total, 3)
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
      assert.strictEqual(role.machine_name, 'test-editor')
      const byMachine = await store.adminRoles.getByMachineName('test-editor')
      assert.strictEqual(byMachine?.id, role.id)
    })

    it('assignToUser is idempotent and listRolesForUser returns the role', async () => {
      const user = await createUser({ email: 'g@example.com', password: 'pw' })
      const role = await createRole({ name: 'test-r', machine_name: 'test-r' })

      await store.adminRoles.assignToUser(role.id, user.id)
      await store.adminRoles.assignToUser(role.id, user.id) // idempotent

      const userRoles = await store.adminRoles.listRolesForUser(user.id)
      assert.strictEqual(userRoles.length, 1)
      assert.strictEqual(userRoles[0]?.machine_name, 'test-r')

      const usersForRole = await store.adminRoles.listUsersForRole(role.id)
      assert.deepStrictEqual(usersForRole, [user.id])
    })

    it('unassignFromUser removes the assignment', async () => {
      const user = await createUser({ email: 'h@example.com', password: 'pw' })
      const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
      await store.adminRoles.assignToUser(role.id, user.id)
      await store.adminRoles.unassignFromUser(role.id, user.id)
      assert.strictEqual((await store.adminRoles.listRolesForUser(user.id)).length, 0)
    })

    it('delete cascades to permissions and role-user assignments', async () => {
      const user = await createUser({ email: 'i@example.com', password: 'pw' })
      const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
      await store.adminPermissions.grantAbility(role.id, 'a.one')
      await store.adminRoles.assignToUser(role.id, user.id)

      await store.adminRoles.delete(role.id)

      // The role is gone…
      assert.strictEqual(await store.adminRoles.getById(role.id), null)
      // …and its grants are gone…
      const grantsForRole = await db
        .select()
        .from(adminPermissions)
        .where(eq(adminPermissions.admin_role_id, role.id))
      assert.strictEqual(grantsForRole.length, 0)
      // …and no assignment for the role remains.
      const assignsForRole = await db
        .select()
        .from(adminRoleAdminUser)
        .where(eq(adminRoleAdminUser.admin_role_id, role.id))
      assert.strictEqual(assignsForRole.length, 0)
      // The user still exists.
      assert.ok(await store.adminUsers.getById(user.id))
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
      assert.deepStrictEqual(abilities, ['collections.pages.publish'])
    })

    it('revokeAbility removes the grant', async () => {
      const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
      await store.adminPermissions.grantAbility(role.id, 'a.one')
      await store.adminPermissions.grantAbility(role.id, 'a.two')
      await store.adminPermissions.revokeAbility(role.id, 'a.one')
      const abilities = await store.adminPermissions.listAbilities(role.id)
      assert.deepStrictEqual(abilities.sort(), ['a.two'])
    })

    it('setAbilities replaces the ability set wholesale', async () => {
      const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
      await store.adminPermissions.grantAbility(role.id, 'a.one')
      await store.adminPermissions.grantAbility(role.id, 'a.two')
      await store.adminPermissions.setAbilities(role.id, ['a.three', 'a.four'])
      const abilities = await store.adminPermissions.listAbilities(role.id)
      assert.deepStrictEqual(abilities.sort(), ['a.four', 'a.three'])
    })
  })

  // -------------------------------------------------------------------------
  // resolveActor
  // -------------------------------------------------------------------------

  describe('resolveActor', () => {
    it('returns null for unknown user ids', async () => {
      const actor = await resolveActor(store, '00000000-0000-7000-8000-000000000000')
      assert.strictEqual(actor, null)
    })

    it('returns null for disabled users', async () => {
      const user = await createUser({ email: 'j@example.com', password: 'pw' })
      // Created with is_enabled: false by default
      const actor = await resolveActor(store, user.id)
      assert.strictEqual(actor, null)
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
      assert.ok(actor instanceof AdminAuth)
      assert.strictEqual(actor.id, user.id)
      assert.strictEqual(actor.isSuperAdmin, false)

      assert.strictEqual(actor.hasAbility('collections.pages.read'), true)
      assert.strictEqual(actor.hasAbility('collections.pages.update'), true)
      assert.strictEqual(actor.hasAbility('collections.pages.publish'), true)
      assert.strictEqual(actor.hasAbility('collections.pages.delete'), false)

      // Distinct — duplicates across roles collapse
      assert.strictEqual(actor.abilities.size, 3)
    })

    it('honours the is_super_admin flag', async () => {
      const user = await createUser({
        email: 'test-root@example.com',
        password: 'pw',
        is_super_admin: true,
        is_enabled: true,
      })
      const actor = await resolveActor(store, user.id)
      assert.ok(actor)
      assert.strictEqual(actor.isSuperAdmin, true)
      // Even without granting any abilities, super-admins pass every check
      assert.strictEqual(actor.hasAbility('anything.at.all'), true)
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

      assert.ok(result.userId)
      assert.ok(result.roleId)
      assert.deepStrictEqual(result.created, { user: true, role: true, assignment: true })

      const actor = await resolveActor(store, result.userId)
      assert.ok(actor)
      assert.strictEqual(actor.isSuperAdmin, true)
    })

    it('is idempotent — second run reports nothing newly created', async () => {
      await db.delete(adminUsers).where(eq(adminUsers.email, seedInput.email))
      await db.delete(adminRoles).where(eq(adminRoles.machine_name, seedInput.roleMachineName))

      const first = await seedSuperAdmin(store, seedInput)
      trackUser(first.userId)
      trackRole(first.roleId)

      const second = await seedSuperAdmin(store, seedInput)
      assert.deepStrictEqual(second.created, {
        user: false,
        role: false,
        assignment: false,
      })
    })
  })
})
