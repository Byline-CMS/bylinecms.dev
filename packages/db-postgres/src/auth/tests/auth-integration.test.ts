/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import assert from 'node:assert'
import { after, before, beforeEach, describe, it } from 'node:test'

import { AdminAuth } from '@byline/auth'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import {
  adminPermissions,
  adminRoleAdminUser,
  adminRoles,
  adminUsers,
} from '../../database/schema/auth.js'
import { setupTestDB, teardownTestDB } from '../../lib/test-helper.js'
import { createAdminRolesRepository } from '../admin-roles-repository.js'
import { createAdminUsersRepository } from '../admin-users-repository.js'
import { verifyPassword } from '../password.js'
import { resolveActor } from '../resolve-actor.js'
import { seedSuperAdmin } from '../seed-super-admin.js'
import type * as schema from '../../database/schema/index.js'

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

let db: NodePgDatabase<typeof schema>

async function cleanAuthTables() {
  // Order matters: permissions / role-user assignments reference roles and
  // users via ON DELETE CASCADE, but we're explicit here for clarity.
  await db.delete(adminPermissions)
  await db.delete(adminRoleAdminUser)
  await db.delete(adminRoles)
  await db.delete(adminUsers)
}

// ---------------------------------------------------------------------------

describe('auth integration', () => {
  before(() => {
    const testDB = setupTestDB([])
    db = testDB.db
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
    it('creates, reads, and hashes the password', async () => {
      const users = createAdminUsersRepository(db)
      const created = await users.create({
        email: 'alice@example.com',
        password: 'alice-password',
        given_name: 'Alice',
      })
      assert.ok(created.id)
      assert.strictEqual(created.email, 'alice@example.com')
      assert.strictEqual(created.given_name, 'Alice')
      assert.strictEqual(created.is_enabled, false) // default false
      assert.strictEqual(created.is_super_admin, false)
      // Public columns: password is never returned
      assert.strictEqual((created as any).password, undefined)

      const fetched = await users.getById(created.id)
      assert.strictEqual(fetched?.email, 'alice@example.com')
    })

    it('lowercases the email on insert and on lookup', async () => {
      const users = createAdminUsersRepository(db)
      await users.create({ email: 'Alice@Example.COM', password: 'pw' })
      const byMixed = await users.getByEmail('ALICE@example.com')
      assert.ok(byMixed)
      assert.strictEqual(byMixed.email, 'alice@example.com')
    })

    it('returns the password only via getByEmailForSignIn', async () => {
      const users = createAdminUsersRepository(db)
      await users.create({ email: 'b@example.com', password: 'pw-value' })

      const plain = await users.getByEmail('b@example.com')
      assert.strictEqual((plain as any)?.password, undefined)

      const withPw = await users.getByEmailForSignIn('b@example.com')
      assert.ok(withPw)
      assert.ok(await verifyPassword('pw-value', withPw.password))
    })

    it('update applies partial patches', async () => {
      const users = createAdminUsersRepository(db)
      const created = await users.create({ email: 'c@example.com', password: 'pw' })
      const updated = await users.update(created.id, {
        given_name: 'Charlie',
        is_enabled: true,
      })
      assert.strictEqual(updated.given_name, 'Charlie')
      assert.strictEqual(updated.is_enabled, true)
      // Unchanged fields remain
      assert.strictEqual(updated.email, 'c@example.com')
    })

    it('setPassword rehashes and subsequently verifies', async () => {
      const users = createAdminUsersRepository(db)
      const created = await users.create({ email: 'd@example.com', password: 'old' })
      await users.setPassword(created.id, 'new-password')

      const signIn = await users.getByEmailForSignIn('d@example.com')
      assert.ok(signIn)
      assert.ok(await verifyPassword('new-password', signIn.password))
      assert.strictEqual(await verifyPassword('old', signIn.password), false)
    })

    it('recordLoginSuccess resets failed_login_attempts and stamps last_login', async () => {
      const users = createAdminUsersRepository(db)
      const created = await users.create({ email: 'e@example.com', password: 'pw' })
      await users.recordLoginFailure(created.id)
      await users.recordLoginFailure(created.id)
      let row = await users.getById(created.id)
      assert.strictEqual(row?.failed_login_attempts, 2)

      await users.recordLoginSuccess(created.id, '10.0.0.1')
      row = await users.getById(created.id)
      assert.strictEqual(row?.failed_login_attempts, 0)
      assert.strictEqual(row?.last_login_ip, '10.0.0.1')
      assert.ok(row?.last_login)
    })

    it('delete removes the row', async () => {
      const users = createAdminUsersRepository(db)
      const created = await users.create({ email: 'f@example.com', password: 'pw' })
      await users.delete(created.id)
      const fetched = await users.getById(created.id)
      assert.strictEqual(fetched, null)
    })
  })

  // -------------------------------------------------------------------------
  // Admin roles + abilities + assignments
  // -------------------------------------------------------------------------

  describe('admin roles repository', () => {
    it('creates and reads a role', async () => {
      const roles = createAdminRolesRepository(db)
      const role = await roles.create({
        name: 'Editor',
        machine_name: 'editor',
        description: 'Can edit content',
      })
      assert.strictEqual(role.machine_name, 'editor')
      const byMachine = await roles.getByMachineName('editor')
      assert.strictEqual(byMachine?.id, role.id)
    })

    it('grantAbility is idempotent', async () => {
      const roles = createAdminRolesRepository(db)
      const role = await roles.create({ name: 'r', machine_name: 'r' })
      await roles.grantAbility(role.id, 'collections.pages.publish')
      await roles.grantAbility(role.id, 'collections.pages.publish')
      const abilities = await roles.listAbilities(role.id)
      assert.deepStrictEqual(abilities, ['collections.pages.publish'])
    })

    it('revokeAbility removes the grant', async () => {
      const roles = createAdminRolesRepository(db)
      const role = await roles.create({ name: 'r', machine_name: 'r' })
      await roles.grantAbility(role.id, 'a.one')
      await roles.grantAbility(role.id, 'a.two')
      await roles.revokeAbility(role.id, 'a.one')
      const abilities = await roles.listAbilities(role.id)
      assert.deepStrictEqual(abilities.sort(), ['a.two'])
    })

    it('setAbilities replaces the ability set wholesale', async () => {
      const roles = createAdminRolesRepository(db)
      const role = await roles.create({ name: 'r', machine_name: 'r' })
      await roles.grantAbility(role.id, 'a.one')
      await roles.grantAbility(role.id, 'a.two')
      await roles.setAbilities(role.id, ['a.three', 'a.four'])
      const abilities = await roles.listAbilities(role.id)
      assert.deepStrictEqual(abilities.sort(), ['a.four', 'a.three'])
    })

    it('assignToUser is idempotent and listRolesForUser returns the role', async () => {
      const users = createAdminUsersRepository(db)
      const roles = createAdminRolesRepository(db)
      const user = await users.create({ email: 'g@example.com', password: 'pw' })
      const role = await roles.create({ name: 'r', machine_name: 'r' })

      await roles.assignToUser(role.id, user.id)
      await roles.assignToUser(role.id, user.id) // idempotent

      const userRoles = await roles.listRolesForUser(user.id)
      assert.strictEqual(userRoles.length, 1)
      assert.strictEqual(userRoles[0]?.machine_name, 'r')

      const usersForRole = await roles.listUsersForRole(role.id)
      assert.deepStrictEqual(usersForRole, [user.id])
    })

    it('unassignFromUser removes the assignment', async () => {
      const users = createAdminUsersRepository(db)
      const roles = createAdminRolesRepository(db)
      const user = await users.create({ email: 'h@example.com', password: 'pw' })
      const role = await roles.create({ name: 'r', machine_name: 'r' })
      await roles.assignToUser(role.id, user.id)
      await roles.unassignFromUser(role.id, user.id)
      assert.strictEqual((await roles.listRolesForUser(user.id)).length, 0)
    })

    it('delete cascades to permissions and role-user assignments', async () => {
      const users = createAdminUsersRepository(db)
      const roles = createAdminRolesRepository(db)
      const user = await users.create({ email: 'i@example.com', password: 'pw' })
      const role = await roles.create({ name: 'r', machine_name: 'r' })
      await roles.grantAbility(role.id, 'a.one')
      await roles.assignToUser(role.id, user.id)

      await roles.delete(role.id)

      // The role is gone…
      assert.strictEqual(await roles.getById(role.id), null)
      // …and all grants are gone…
      const permRows = await db.select().from(adminPermissions)
      assert.strictEqual(permRows.length, 0)
      // …and no assignment remains.
      const assignRows = await db.select().from(adminRoleAdminUser)
      assert.strictEqual(assignRows.length, 0)
      // The user still exists.
      assert.ok(await users.getById(user.id))
    })
  })

  // -------------------------------------------------------------------------
  // resolveActor
  // -------------------------------------------------------------------------

  describe('resolveActor', () => {
    it('returns null for unknown user ids', async () => {
      const actor = await resolveActor(db, '00000000-0000-7000-8000-000000000000')
      assert.strictEqual(actor, null)
    })

    it('returns null for disabled users', async () => {
      const users = createAdminUsersRepository(db)
      const user = await users.create({ email: 'j@example.com', password: 'pw' })
      // Created with is_enabled: false by default
      const actor = await resolveActor(db, user.id)
      assert.strictEqual(actor, null)
    })

    it('builds an AdminAuth with the union of abilities across roles', async () => {
      const users = createAdminUsersRepository(db)
      const roles = createAdminRolesRepository(db)

      const user = await users.create({
        email: 'k@example.com',
        password: 'pw',
        is_enabled: true,
      })
      const roleA = await roles.create({ name: 'A', machine_name: 'a' })
      const roleB = await roles.create({ name: 'B', machine_name: 'b' })

      await roles.grantAbility(roleA.id, 'collections.pages.read')
      await roles.grantAbility(roleA.id, 'collections.pages.update')
      await roles.grantAbility(roleB.id, 'collections.pages.update') // duplicate across roles
      await roles.grantAbility(roleB.id, 'collections.pages.publish')

      await roles.assignToUser(roleA.id, user.id)
      await roles.assignToUser(roleB.id, user.id)

      const actor = await resolveActor(db, user.id)
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
      const users = createAdminUsersRepository(db)
      const user = await users.create({
        email: 'root@example.com',
        password: 'pw',
        is_super_admin: true,
        is_enabled: true,
      })
      const actor = await resolveActor(db, user.id)
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
      const result = await seedSuperAdmin(db, {
        email: 'root@byline.local',
        password: 'initial-password',
      })
      assert.ok(result.userId)
      assert.ok(result.roleId)
      assert.deepStrictEqual(result.created, { user: true, role: true, assignment: true })

      const actor = await resolveActor(db, result.userId)
      assert.ok(actor)
      assert.strictEqual(actor.isSuperAdmin, true)
    })

    it('is idempotent — second run reports nothing newly created', async () => {
      await seedSuperAdmin(db, {
        email: 'root@byline.local',
        password: 'initial-password',
      })
      const second = await seedSuperAdmin(db, {
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
