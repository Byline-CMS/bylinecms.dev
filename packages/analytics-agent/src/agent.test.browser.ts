/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface BeaconCall {
  url: string
  body: Blob
}

let beacons: BeaconCall[]
const endpoint = '/telemetry/events'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  beacons = []
  document.body.replaceChildren()
  localStorage.clear()
  history.replaceState(null, '', '/story?preview=1#lead')
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (url: string, body: Blob) => {
      beacons.push({ url, body })
      return true
    },
  })
})

describe('analytics browser agent', () => {
  it('sends one initial view and only committed path changes supplied by the host', async () => {
    const { ANALYTICS_NAVIGATION_EVENT, installAnalyticsAgent } = await import('./index.js')

    const controller = installAnalyticsAgent({ endpoint })
    expect(installAnalyticsAgent({ endpoint })).toBe(controller)
    expect(await payloads()).toEqual([{ v: 1, kind: 'page', path: '/story', ref: '' }])

    document.dispatchEvent(
      new CustomEvent(ANALYTICS_NAVIGATION_EVENT, { detail: '/story?preview=2#other' })
    )
    document.dispatchEvent(
      new CustomEvent(ANALYTICS_NAVIGATION_EVENT, { detail: '/next?preview=1#lead' })
    )

    expect(await payloads()).toEqual([
      { v: 1, kind: 'page', path: '/story', ref: '' },
      { v: 1, kind: 'page', path: '/next', ref: '' },
    ])
    expect(beacons.every((call) => call.url === endpoint)).toBe(true)
    expect(beacons.every((call) => call.body.type === 'text/plain')).toBe(true)
    controller.stop()
  })

  it('continues to ignore search-only and hash-only changes after the old debounce window', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    const { ANALYTICS_NAVIGATION_EVENT, installAnalyticsAgent } = await import('./index.js')
    const controller = installAnalyticsAgent({ endpoint })

    now.mockReturnValue(10_000)
    document.dispatchEvent(
      new CustomEvent(ANALYTICS_NAVIGATION_EVENT, { detail: '/story?preview=2#other' })
    )

    expect(await payloads()).toEqual([{ v: 1, kind: 'page', path: '/story', ref: '' }])
    controller.stop()
  })

  it('reports delegated CDN downloads without cancelling the click', async () => {
    const { installAnalyticsAgent } = await import('./index.js')
    const anchor = document.createElement('a')
    anchor.href = 'https://cdn.example.com/files/archive.bin?token=private'
    anchor.target = '_blank'
    const child = document.createElement('span')
    anchor.append(child)
    document.body.append(anchor)

    const controller = installAnalyticsAgent({ endpoint, cdnHosts: ['CDN.EXAMPLE.COM'] })
    beacons = []
    child.addEventListener('click', (event) => event.stopPropagation())
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    child.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
    expect(await payloads()).toEqual([
      { v: 1, kind: 'download', path: '/files/archive.bin', ref: '' },
    ])
    controller.stop()
  })

  it('honors the explicit browser-local exclusion flag without writing storage', async () => {
    const { ANALYTICS_IGNORE_STORAGE_KEY, installAnalyticsAgent } = await import('./index.js')
    localStorage.setItem(ANALYTICS_IGNORE_STORAGE_KEY, '1')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const controller = installAnalyticsAgent({ endpoint })
    expect(beacons).toHaveLength(0)
    expect(setItem).not.toHaveBeenCalled()

    localStorage.removeItem(ANALYTICS_IGNORE_STORAGE_KEY)
    controller.page('/included')
    expect(await payloads()).toEqual([{ v: 1, kind: 'page', path: '/included', ref: '' }])
    controller.stop()
  })

  it('stops collecting when a consent owner removes the agent', async () => {
    const { ANALYTICS_NAVIGATION_EVENT, ANALYTICS_STOP_EVENT, installAnalyticsAgent } =
      await import('./index.js')
    installAnalyticsAgent({ endpoint })
    beacons = []

    document.dispatchEvent(new Event(ANALYTICS_STOP_EVENT))
    document.dispatchEvent(new CustomEvent(ANALYTICS_NAVIGATION_EVENT, { detail: '/after-stop' }))

    expect(beacons).toHaveLength(0)
  })

  it('requires an explicit same-origin, root-relative endpoint', async () => {
    const { installAnalyticsAgent } = await import('./index.js')

    expect(() => installAnalyticsAgent({ endpoint: 'https://collector.example/events' })).toThrow(
      'same-origin, root-relative path'
    )
  })

  it('reads the application-owned endpoint from the standalone script element', async () => {
    const { analyticsAgentConfigFromScript } = await import('./index.js')
    const script = document.createElement('script')
    script.dataset.endpoint = '/first-party/collect'
    script.dataset.ignorePrefixes = '/admin,/private'

    expect(analyticsAgentConfigFromScript(script)).toMatchObject({
      endpoint: '/first-party/collect',
      ignoredPathPrefixes: ['/admin', '/private'],
    })
    expect(analyticsAgentConfigFromScript(null)).toBeNull()
  })
})

async function payloads(): Promise<unknown[]> {
  return Promise.all(beacons.map(async ({ body }) => JSON.parse(await body.text()) as unknown))
}
