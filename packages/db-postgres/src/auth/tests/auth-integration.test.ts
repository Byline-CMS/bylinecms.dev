/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import assert from 'node:assert'
import { after, before, beforeEach, describe, it } from 'node:test'

import type { AdminStore } from '@byline/admin'
import { seedSuperAdmin } from '@byline/admin/admin-users'
import { hashPassword, resolveActor, verifyPassword } from '@byline/admin/auth'
import { AdminAuth } from '@byline/auth'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import {
  adminPermissions,
  adminRoleAdminUser,
  adminRoles,
  adminUsers,
} from '../../database/schema/auth.js'
import { setupTestDB, teardownTestDB } from '../../lib/test-helper.js'
import { createAdminStore } from '../admin-store.js'
import type * as schema from '../../database/schema/index.js'

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

let db: NodePgDatabase<typeof schema>
let store: AdminStore

async function cleanAuthTables() {
  await db.delete(adminPermissions)
  await db.delete(adminRoleAdminUser)
  await db.delete(adminRoles)
  await db.delete(adminUsers)
}

/**
 * Hash-and-create helper — the repository takes `password_hash` and is
 * deliberately not aware of hashing. Every test that wants a user with a
 * verifiable password goes through here.
 */
async function createUser(input: {
  email: string
  password: string
  given_name?: string | null
  is_enabled?: boolean
  is_super_admin?: boolean
}) {
  const password_hash = await hashPassword(input.password)
  return store.adminUsers.create({
    email: input.email,
    password_hash,
    given_name: input.given_name,
    is_enabled: input.is_enabled,
    is_super_admin: input.is_super_admin,
  })
}

// ---------------------------------------------------------------------------

describe('auth integration', () => {
  before(() => {
    const testDB = setupTestDB([])
    db = testDB.db
    store = createAdminStore(db)
  })

  beforeEach(async () => {
    await cleanAuthTables()
  })

  after(async () => {
    await cleanAuthTables()
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

    it('update applies partial patches', async () => {
      const created = await createUser({ email: 'c@example.com', password: 'pw' })
      const updated = await store.adminUsers.update(created.id, {
        given_name: 'Charlie',
        is_enabled: true,
      })
      assert.strictEqual(updated.given_name, 'Charlie')
      assert.strictEqual(updated.is_enabled, true)
      // Unchanged fields remain
      assert.strictEqual(updated.email, 'c@example.com')
    })

    it('setPasswordHash rehashes and subsequently verifies', async () => {
      const created = await createUser({ email: 'd@example.com', password: 'old' })
      await store.adminUsers.setPasswordHash(created.id, await hashPassword('new-password'))

      const signIn = await store.adminUsers.getByEmailForSignIn('d@example.com')
      assert.ok(signIn)
      assert.ok(await verifyPassword('new-password', signIn.password_hash))
      assert.strictEqual(await verifyPassword('old', signIn.password_hash), false)
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

    it('delete removes the row', async () => {
      const created = await createUser({ email: 'f@example.com', password: 'pw' })
      await store.adminUsers.delete(created.id)
      const fetched = await store.adminUsers.getById(created.id)
      assert.strictEqual(fetched, null)
    })
  })

  // -------------------------------------------------------------------------
  // Admin roles + assignments
  // -------------------------------------------------------------------------

  describe('admin roles repository', () => {
    it('creates and reads a role', async () => {
      const role = await store.adminRoles.create({
        name: 'Editor',
        machine_name: 'editor',
        description: 'Can edit content',
      })
      assert.strictEqual(role.machine_name, 'editor')
      const byMachine = await store.adminRoles.getByMachineName('editor')
      assert.strictEqual(byMachine?.id, role.id)
    })

    it('assignToUser is idempotent and listRolesForUser returns the role', async () => {
      const user = await createUser({ email: 'g@example.com', password: 'pw' })
      const role = await store.adminRoles.create({ name: 'r', machine_name: 'r' })

      await store.adminRoles.assignToUser(role.id, user.id)
      await store.adminRoles.assignToUser(role.id, user.id) // idempotent

      const userRoles = await store.adminRoles.listRolesForUser(user.id)
      assert.strictEqual(userRoles.length, 1)
      assert.strictEqual(userRoles[0]?.machine_name, 'r')

      const usersForRole = await store.adminRoles.listUsersForRole(role.id)
      assert.deepStrictEqual(usersForRole, [user.id])
    })

    it('unassignFromUser removes the assignment', async () => {
      const user = await createUser({ email: 'h@example.com', password: 'pw' })
      const role = await store.adminRoles.create({ name: 'r', machine_name: 'r' })
      await store.adminRoles.assignToUser(role.id, user.id)
      await store.adminRoles.unassignFromUser(role.id, user.id)
      assert.strictEqual((await store.adminRoles.listRolesForUser(user.id)).length, 0)
    })

    it('delete cascades to permissions and role-user assignments', async () => {
      const user = await createUser({ email: 'i@example.com', password: 'pw' })
      const role = await store.adminRoles.create({ name: 'r', machine_name: 'r' })
      await store.adminPermissions.grantAbility(role.id, 'a.one')
      await store.adminRoles.assignToUser(role.id, user.id)

      await store.adminRoles.delete(role.id)

      // The role is gone…
      assert.strictEqual(await store.adminRoles.getById(role.id), null)
      // …and all grants are gone…
      const permRows = await db.select().from(adminPermissions)
      assert.strictEqual(permRows.length, 0)
      // …and no assignment remains.
      const assignRows = await db.select().from(adminRoleAdminUser)
      assert.strictEqual(assignRows.length, 0)
      // The user still exists.
      assert.ok(await store.adminUsers.getById(user.id))
    })
  })

  // -------------------------------------------------------------------------
  // Admin permissions
  // -------------------------------------------------------------------------

  describe('admin permissions repository', () => {
    it('grantAbility is idempotent', async () => {
      const role = await store.adminRoles.create({ name: 'r', machine_name: 'r' })
      await store.adminPermissions.grantAbility(role.id, 'collections.pages.publish')
      await store.adminPermissions.grantAbility(role.id, 'collections.pages.publish')
      const abilities = await store.adminPermissions.listAbilities(role.id)
      assert.deepStrictEqual(abilities, ['collections.pages.publish'])
    })

    it('revokeAbility removes the grant', async () => {
      const role = await store.adminRoles.create({ name: 'r', machine_name: 'r' })
      await store.adminPermissions.grantAbility(role.id, 'a.one')
      await store.adminPermissions.grantAbility(role.id, 'a.two')
      await store.adminPermissions.revokeAbility(role.id, 'a.one')
      const abilities = await store.adminPermissions.listAbilities(role.id)
      assert.deepStrictEqual(abilities.sort(), ['a.two'])
    })

    it('setAbilities replaces the ability set wholesale', async () => {
      const role = await store.adminRoles.create({ name: 'r', machine_name: 'r' })
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
      const roleA = await store.adminRoles.create({ name: 'A', machine_name: 'a' })
      const roleB = await store.adminRoles.create({ name: 'B', machine_name: 'b' })

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
        email: 'root@example.com',
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
  // -------------------------------------------------------------------------

  describe('seedSuperAdmin', () => {
    it('creates role + user + assignment on a fresh database', async () => {
      const result = await seedSuperAdmin(store, {
        email: 'root@byline.local',
        password: 'initial-password',
      })
      assert.ok(result.userId)
      assert.ok(result.roleId)
      assert.deepStrictEqual(result.created, { user: true, role: true, assignment: true })

      const actor = await resolveActor(store, result.userId)
      assert.ok(actor)
      assert.strictEqual(actor.isSuperAdmin, true)
    })

    it('is idempotent — second run reports nothing newly created', async () => {
      await seedSuperAdmin(store, {
        email: 'root@byline.local',
        password: 'initial-password',
      })
      const second = await seedSuperAdmin(store, {
        email: 'root@byline.local',
        password: 'initial-password',
      })
      assert.deepStrictEqual(second.created, {
        user: false,
        role: false,
        assignment: false,
      })
    })
  })
})
