/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { IStorageProvider } from '@byline/core'
import { ErrorCodes } from '@byline/core'
import { runStorageProviderConformanceSuite } from '@byline/storage-conformance'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { localStorageProvider } from './local-storage-provider.js'

const roots: string[] = []

function freshProvider(): { provider: IStorageProvider; uploadDir: string } {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-storage-local-'))
  roots.push(uploadDir)
  return { provider: localStorageProvider({ uploadDir, baseUrl: '/uploads' }), uploadDir }
}

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

/**
 * Makes the next `rename` onto a public path (not a private `.tmp` name) fail
 * with EXDEV — in a move, that is the final rename onto the destination.
 */
function forceExdevOnce() {
  const realRename = fs.promises.rename.bind(fs.promises)
  let armed = true
  return vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
    if (armed && !String(to).endsWith('.tmp')) {
      armed = false
      const err = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException
      err.code = 'EXDEV'
      throw err
    }
    return realRename(from, to)
  })
}

runStorageProviderConformanceSuite({
  name: 'storage-local',
  createProvider: () => freshProvider().provider,
  validatorKinds: ['local-stat'],
  extraReplacers: [
    {
      name: 'cross-filesystem move',
      replace: async (provider, storagePath, bytes) => {
        const staging = `conformance/staging-exdev-${Date.now()}.bin`
        await provider.upload(bytes, {
          filename: 'staging.bin',
          mimeType: 'application/octet-stream',
          size: bytes.length,
          targetStoragePath: staging,
        })
        const spy = forceExdevOnce()
        try {
          await provider.move?.(staging, storagePath)
        } finally {
          spy.mockRestore()
        }
      },
    },
  ],
})

describe('storage-local writes', () => {
  it('leaves no temporary files behind after uploads and moves', async () => {
    const { provider, uploadDir } = freshProvider()
    const bytes = Buffer.from('content')
    const opts = { filename: 'a.txt', mimeType: 'text/plain', size: bytes.length }

    await provider.upload(bytes, { ...opts, targetStoragePath: 'media/a.txt' })
    await provider.upload(bytes, { ...opts, targetStoragePath: 'media/a.txt' })
    await provider.upload(bytes, { ...opts, targetStoragePath: 'media/b.txt' })
    await provider.move?.('media/b.txt', 'media/c.txt')

    expect(fs.readdirSync(path.join(uploadDir, 'media')).sort()).toEqual(['a.txt', 'c.txt'])
  })

  it('keeps the validator across a same-filesystem move', async () => {
    const { provider } = freshProvider()
    const bytes = Buffer.from('moved')
    const uploaded = await provider.upload(bytes, {
      filename: 'm.txt',
      mimeType: 'text/plain',
      size: bytes.length,
      targetStoragePath: 'media/m.txt',
    })
    const moved = await provider.move?.('media/m.txt', 'archive/m.txt')

    expect(moved?.storageValidator).toEqual(uploaded.storageValidator)
    expect((await provider.head?.('archive/m.txt'))?.validator).toEqual(uploaded.storageValidator)
  })

  it('gives a cross-filesystem move a new validator and removes the source', async () => {
    const { provider, uploadDir } = freshProvider()
    const bytes = Buffer.from('exdev')
    const uploaded = await provider.upload(bytes, {
      filename: 'x.txt',
      mimeType: 'text/plain',
      size: bytes.length,
      targetStoragePath: 'media/x.txt',
    })

    const spy = forceExdevOnce()
    let moved: Awaited<ReturnType<NonNullable<IStorageProvider['move']>>> | undefined
    try {
      moved = await provider.move?.('media/x.txt', 'archive/x.txt')
    } finally {
      spy.mockRestore()
    }

    expect(moved?.storageValidator).not.toEqual(uploaded.storageValidator)
    expect(fs.existsSync(path.join(uploadDir, 'media/x.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(uploadDir, 'archive/x.txt'), 'utf8')).toBe('exdev')
  })

  it('reports a committed destination when the source cannot be removed after EXDEV', async () => {
    const { provider, uploadDir } = freshProvider()
    const bytes = Buffer.from('stuck')
    await provider.upload(bytes, {
      filename: 's.txt',
      mimeType: 'text/plain',
      size: bytes.length,
      targetStoragePath: 'media/s.txt',
    })

    const renameSpy = forceExdevOnce()
    const unlinkSpy = vi
      .spyOn(fs.promises, 'unlink')
      .mockRejectedValueOnce(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }))
    let error: unknown
    try {
      await provider.move?.('media/s.txt', 'archive/s.txt')
    } catch (err) {
      error = err
    } finally {
      renameSpy.mockRestore()
      unlinkSpy.mockRestore()
    }

    expect(error).toMatchObject({
      code: ErrorCodes.STORAGE,
      details: expect.objectContaining({
        reason: 'source-not-removed',
        destinationCommitted: true,
        location: expect.objectContaining({
          storagePath: 'archive/s.txt',
          storageValidator: expect.objectContaining({ kind: 'local-stat' }),
        }),
      }),
    })
    expect(fs.readFileSync(path.join(uploadDir, 'archive/s.txt'), 'utf8')).toBe('stuck')
  })

  it('leaves the destination untouched when the cross-filesystem copy fails', async () => {
    const { provider, uploadDir } = freshProvider()
    const opts = { filename: 'd.txt', mimeType: 'text/plain' }
    await provider.upload(Buffer.from('src'), {
      ...opts,
      size: 3,
      targetStoragePath: 'media/d.txt',
    })
    await provider.upload(Buffer.from('dest'), {
      ...opts,
      size: 4,
      targetStoragePath: 'archive/d.txt',
    })

    const renameSpy = forceExdevOnce()
    const copySpy = vi
      .spyOn(fs.promises, 'copyFile')
      .mockRejectedValueOnce(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }))
    try {
      await expect(provider.move?.('media/d.txt', 'archive/d.txt')).rejects.toMatchObject({
        code: 'ENOSPC',
      })
    } finally {
      renameSpy.mockRestore()
      copySpy.mockRestore()
    }

    expect(fs.readFileSync(path.join(uploadDir, 'archive/d.txt'), 'utf8')).toBe('dest')
    expect(fs.readFileSync(path.join(uploadDir, 'media/d.txt'), 'utf8')).toBe('src')
    expect(fs.readdirSync(path.join(uploadDir, 'archive'))).toEqual(['d.txt'])
    // The claimed source was put back; no private copy is left behind.
    expect(fs.readdirSync(path.join(uploadDir, 'media'))).toEqual(['d.txt'])
  })

  describe('move with a concurrent upload to the source path', () => {
    const text = (s: string) => Buffer.from(s)
    const opts = (size: number, targetStoragePath: string) => ({
      filename: 'f.txt',
      mimeType: 'text/plain',
      size,
      targetStoragePath,
    })

    /**
     * Runs `replace` once, just before the first `fs.promises[method]` call
     * that matches `when`, then lets that call proceed.
     */
    function interceptOnce(
      method: 'rename' | 'copyFile',
      when: (from: string, to: string) => boolean,
      replace: () => Promise<unknown>
    ) {
      const real = (fs.promises[method] as (...args: unknown[]) => Promise<void>).bind(fs.promises)
      let armed = true
      return vi.spyOn(fs.promises, method).mockImplementation((async (
        from: unknown,
        to: unknown,
        ...rest: unknown[]
      ) => {
        if (armed && when(String(from), String(to))) {
          armed = false
          await replace()
        }
        return real(from, to, ...rest)
      }) as never)
    }

    it('moves whatever the claim took and returns that file’s validator', async () => {
      const { provider, uploadDir } = freshProvider()
      await provider.upload(text('old'), opts(3, 'media/src.txt'))

      // A Byline upload replaces the source just before the claim.
      const spy = interceptOnce(
        'rename',
        (from) => from === path.join(uploadDir, 'media/src.txt'),
        () => provider.upload(text('replacement'), opts(11, 'media/src.txt'))
      )
      let moved: Awaited<ReturnType<NonNullable<IStorageProvider['move']>>> | undefined
      try {
        moved = await provider.move?.('media/src.txt', 'archive/dst.txt')
      } finally {
        spy.mockRestore()
      }

      expect(fs.readFileSync(path.join(uploadDir, 'archive/dst.txt'), 'utf8')).toBe('replacement')
      expect(moved?.storageValidator).toEqual((await provider.head?.('archive/dst.txt'))?.validator)
    })

    it('keeps a source written after the claim and binds the validator to the moved file', async () => {
      const { provider, uploadDir } = freshProvider()
      await provider.upload(text('old'), opts(3, 'media/src.txt'))

      // A Byline upload writes a new source after the claim, before the final rename.
      const spy = interceptOnce(
        'rename',
        (from, to) => from.endsWith('.tmp') && to === path.join(uploadDir, 'archive/dst.txt'),
        () => provider.upload(text('newer'), opts(5, 'media/src.txt'))
      )
      let moved: Awaited<ReturnType<NonNullable<IStorageProvider['move']>>> | undefined
      try {
        moved = await provider.move?.('media/src.txt', 'archive/dst.txt')
      } finally {
        spy.mockRestore()
      }

      expect(fs.readFileSync(path.join(uploadDir, 'archive/dst.txt'), 'utf8')).toBe('old')
      expect(moved?.storageValidator).toEqual((await provider.head?.('archive/dst.txt'))?.validator)
      expect(fs.readFileSync(path.join(uploadDir, 'media/src.txt'), 'utf8')).toBe('newer')
    })

    it('never removes a source written during a cross-filesystem move', async () => {
      const { provider, uploadDir } = freshProvider()
      await provider.upload(text('old'), opts(3, 'media/src.txt'))

      const exdev = forceExdevOnce()
      const copy = interceptOnce(
        'copyFile',
        () => true,
        () => provider.upload(text('newer'), opts(5, 'media/src.txt'))
      )
      let moved: Awaited<ReturnType<NonNullable<IStorageProvider['move']>>> | undefined
      try {
        moved = await provider.move?.('media/src.txt', 'archive/dst.txt')
      } finally {
        exdev.mockRestore()
        copy.mockRestore()
      }

      expect(fs.readFileSync(path.join(uploadDir, 'archive/dst.txt'), 'utf8')).toBe('old')
      expect(moved?.storageValidator).toEqual((await provider.head?.('archive/dst.txt'))?.validator)
      expect(fs.readFileSync(path.join(uploadDir, 'media/src.txt'), 'utf8')).toBe('newer')
      expect(fs.readdirSync(path.join(uploadDir, 'media'))).toEqual(['src.txt'])
    })
  })

  it('closes the file handle when an expectation fails', async () => {
    const { provider } = freshProvider()
    const bytes = Buffer.from('handle')
    await provider.upload(bytes, {
      filename: 'h.txt',
      mimeType: 'text/plain',
      size: bytes.length,
      targetStoragePath: 'media/h.txt',
    })

    const closeSpy = vi.fn()
    const realOpen = fs.promises.open.bind(fs.promises)
    const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...(args as Parameters<typeof realOpen>))
      const realClose = handle.close.bind(handle)
      handle.close = async () => {
        closeSpy()
        return realClose()
      }
      return handle
    })
    try {
      await expect(
        provider.download?.('media/h.txt', { expect: { kind: 'local-stat', value: 'stale' } })
      ).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'changed' }) })
    } finally {
      openSpy.mockRestore()
    }
    expect(closeSpy).toHaveBeenCalledOnce()
  })

  describe('move recovery after the source is claimed', () => {
    const text = (s: string) => Buffer.from(s)
    const opts = (size: number, targetStoragePath: string) => ({
      filename: 'f.txt',
      mimeType: 'text/plain',
      size,
      targetStoragePath,
    })
    const fsError = (code: string) => Object.assign(new Error(code), { code })

    it('restores the source when stating the claimed file fails', async () => {
      const { provider, uploadDir } = freshProvider()
      await provider.upload(text('old'), opts(3, 'media/src.txt'))

      const realStat = fs.promises.stat.bind(fs.promises)
      const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation((async (
        target: unknown,
        options: unknown
      ) => {
        const p = String(target)
        if (p.startsWith(path.join(uploadDir, 'media/src.txt.')) && p.endsWith('.tmp')) {
          throw fsError('EIO')
        }
        return realStat(target as string, options as never)
      }) as never)
      try {
        await expect(provider.move?.('media/src.txt', 'archive/dst.txt')).rejects.toMatchObject({
          code: 'EIO',
        })
      } finally {
        statSpy.mockRestore()
      }

      expect(fs.readFileSync(path.join(uploadDir, 'media/src.txt'), 'utf8')).toBe('old')
      expect(fs.existsSync(path.join(uploadDir, 'archive/dst.txt'))).toBe(false)
      expect(fs.readdirSync(path.join(uploadDir, 'media'))).toEqual(['src.txt'])
    })

    it('still restores the source and names the retained temp when EXDEV cleanup fails', async () => {
      const { provider, uploadDir } = freshProvider()
      await provider.upload(text('old'), opts(3, 'media/src.txt'))

      const exdev = forceExdevOnce()
      const copy = vi.spyOn(fs.promises, 'copyFile').mockRejectedValueOnce(fsError('ENOSPC'))
      const rm = vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(fsError('EBUSY'))
      let error: unknown
      try {
        await provider.move?.('media/src.txt', 'archive/dst.txt')
      } catch (err) {
        error = err
      } finally {
        exdev.mockRestore()
        copy.mockRestore()
        rm.mockRestore()
      }

      expect(error).toMatchObject({
        code: ErrorCodes.STORAGE,
        details: expect.objectContaining({
          reason: 'move-failed',
          destinationCommitted: false,
          sourceRestored: true,
          temporaryPath: expect.stringMatching(/^archive\/dst\.txt\..+\.tmp$/),
        }),
      })
      expect((error as { cause?: { code?: string } }).cause?.code).toBe('ENOSPC')
      expect(fs.readFileSync(path.join(uploadDir, 'media/src.txt'), 'utf8')).toBe('old')
      expect(fs.readdirSync(path.join(uploadDir, 'media'))).toEqual(['src.txt'])
    })

    it('refuses to overwrite a source written meanwhile and names the claimed copy', async () => {
      const { provider, uploadDir } = freshProvider()
      await provider.upload(text('old'), opts(3, 'media/src.txt'))
      const destination = path.join(uploadDir, 'archive/dst.txt')

      // The final rename fails, and a Byline upload writes a new source first.
      const realRename = fs.promises.rename.bind(fs.promises)
      let armed = true
      const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation((async (
        from: unknown,
        to: unknown
      ) => {
        if (armed && String(from).endsWith('.tmp') && String(to) === destination) {
          armed = false
          renameSpy.mockRestore()
          await provider.upload(text('newer'), opts(5, 'media/src.txt'))
          throw fsError('EACCES')
        }
        return realRename(from as string, to as string)
      }) as never)
      let error: unknown
      try {
        await provider.move?.('media/src.txt', 'archive/dst.txt')
      } catch (err) {
        error = err
      } finally {
        renameSpy.mockRestore()
      }

      expect(error).toMatchObject({
        code: ErrorCodes.STORAGE,
        details: expect.objectContaining({
          reason: 'source-not-restored',
          destinationCommitted: false,
          restoreError: 'EEXIST',
        }),
      })
      expect((error as { cause?: { code?: string } }).cause?.code).toBe('EACCES')
      const claimedPath = (error as { details: { claimedPath: string } }).details.claimedPath
      expect(fs.readFileSync(path.join(uploadDir, claimedPath), 'utf8')).toBe('old')
      expect(fs.readFileSync(path.join(uploadDir, 'media/src.txt'), 'utf8')).toBe('newer')
      expect(fs.existsSync(destination)).toBe(false)
    })
  })
})
