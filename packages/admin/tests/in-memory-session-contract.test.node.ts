import { describe, expect, it } from 'vitest'

import { createInMemoryAdminUsersRepository } from './fixtures/in-memory-admin-users-repository.js'

async function fixture() {
  const repo = createInMemoryAdminUsersRepository()
  const user = await repo.create({
    email: 'one@example.test',
    password_hash: 'old',
    is_enabled: true,
  })
  const other = await repo.create({
    email: 'two@example.test',
    password_hash: 'old',
    is_enabled: true,
  })
  repo.__issueSession(user.id)
  repo.__issueSession(user.id)
  const otherSession = repo.__issueSession(other.id)
  return { repo, user, other, otherSession }
}

describe('in-memory account session contract', () => {
  it('password writes advance the generation and revoke only the target user sessions', async () => {
    const { repo, user, other, otherSession } = await fixture()
    const updated = await repo.setPasswordHash(user.id, user.vid, 'new')
    expect(await repo.getByIdForSignIn(user.id)).toMatchObject({
      session_version: 1,
      password_hash: 'new',
    })
    expect(repo.__activeSessions(user.id)).toEqual([])
    expect(repo.__activeSessions(other.id)).toEqual([otherSession])
    repo.__issueSession(user.id)
    await repo.setPasswordHash(user.id, updated.vid, 'newer')
    expect((await repo.getByIdForSignIn(user.id))?.session_version).toBe(2)
    expect(repo.__activeSessions(user.id)).toEqual([])
  })
  it.each(['setEnabled', 'update'])('%s disable/re-enable preserves revocation', async (path) => {
    const { repo, user } = await fixture()
    if (path === 'setEnabled') await repo.setEnabled(user.id, false)
    else await repo.update(user.id, user.vid, { is_enabled: false })
    expect((await repo.getByIdForSignIn(user.id))?.session_version).toBe(1)
    expect(repo.__activeSessions(user.id)).toEqual([])
    expect(() => repo.__issueSession(user.id)).toThrow()
    await repo.setEnabled(user.id, true)
    expect((await repo.getByIdForSignIn(user.id))?.session_version).toBe(1)
    expect(repo.__activeSessions(user.id)).toEqual([])
  })
  it('stale password/disable writes leave both account and sessions untouched', async () => {
    const { repo, user } = await fixture()
    const before = await repo.getByIdForSignIn(user.id)
    const sessions = repo.__activeSessions(user.id)
    await expect(repo.setPasswordHash(user.id, user.vid + 1, 'new')).rejects.toThrow()
    await expect(repo.update(user.id, user.vid + 1, { is_enabled: false })).rejects.toThrow()
    expect(await repo.getByIdForSignIn(user.id)).toEqual(before)
    expect(repo.__activeSessions(user.id)).toEqual(sessions)
  })
})
