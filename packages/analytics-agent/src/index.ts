/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export const ANALYTICS_NAVIGATION_EVENT = 'byline:analytics:navigate'
export const ANALYTICS_STOP_EVENT = 'byline:analytics:stop'
export const ANALYTICS_IGNORE_STORAGE_KEY = 'byline-analytics-ignore'

export const DEFAULT_DOWNLOAD_EXTENSIONS = [
  'pdf',
  'zip',
  'docx',
  'xlsx',
  'pptx',
  'csv',
  'mp3',
  'mp4',
  'epub',
] as const

export interface AnalyticsAgentConfig {
  /** Same-origin, root-relative application route that receives events. */
  endpoint: string
  cdnHosts?: readonly string[]
  downloadExtensions?: readonly string[]
  ignoredPathPrefixes?: readonly string[]
  countSearchChanges?: boolean
  countHashChanges?: boolean
}

export interface AnalyticsAgentController {
  /** Feed only committed/resolved navigation locations into the agent. */
  page(location?: string): void
  stop(): void
}

let activeController: AnalyticsAgentController | undefined
let initialViewSent = false

export function installAnalyticsAgent(config: AnalyticsAgentConfig): AnalyticsAgentController {
  if (activeController != null) return activeController

  const endpoint = normalizeEndpoint(config.endpoint)
  const cdnHosts = normalizeSet(config.cdnHosts, normalizeHost)
  const extensions = normalizeSet(
    config.downloadExtensions ?? DEFAULT_DOWNLOAD_EXTENSIONS,
    normalizeExtension
  )
  const ignoredPrefixes = normalizePrefixes(config.ignoredPathPrefixes ?? ['/_byline'])
  let lastLocation = ''

  const page = (rawLocation = window.location.href): void => {
    try {
      const url = new URL(rawLocation, window.location.href)
      if (isIgnored(url.pathname, ignoredPrefixes)) return
      const identity =
        url.pathname +
        (config.countSearchChanges === true ? url.search : '') +
        (config.countHashChanges === true ? url.hash : '')
      if (identity === lastLocation) return
      lastLocation = identity
      send(endpoint, 'page', identity)
    } catch {
      // Collection must never affect the host page.
    }
  }

  const navigationListener = (event: Event): void => {
    const location = (event as CustomEvent<unknown>).detail
    if (typeof location === 'string') page(location)
  }

  const clickListener = (event: MouseEvent): void => {
    try {
      const anchor = (event.target as Element | null)?.closest?.(
        'a[href]'
      ) as HTMLAnchorElement | null
      if (anchor == null) return
      const url = new URL(anchor.href, window.location.href)
      const extension = url.pathname.split('.').pop()?.toLowerCase() ?? ''
      if (!cdnHosts.has(normalizeHost(url.host)) && !extensions.has(extension)) return
      send(endpoint, 'download', url.pathname)
    } catch {
      // Never cancel or delay navigation because measurement failed.
    }
  }

  document.addEventListener(ANALYTICS_NAVIGATION_EVENT, navigationListener)
  document.addEventListener('click', clickListener, true)

  let controller: AnalyticsAgentController
  const stopListener = (): void => controller.stop()
  controller = {
    page,
    stop() {
      document.removeEventListener(ANALYTICS_NAVIGATION_EVENT, navigationListener)
      document.removeEventListener(ANALYTICS_STOP_EVENT, stopListener)
      document.removeEventListener('click', clickListener, true)
      if (activeController === controller) activeController = undefined
    },
  }
  document.addEventListener(ANALYTICS_STOP_EVENT, stopListener)
  activeController = controller

  if (!initialViewSent) {
    initialViewSent = true
    page()
  }
  return controller
}

export function analyticsAgentConfigFromScript(
  script: HTMLScriptElement | null
): AnalyticsAgentConfig | null {
  if (script == null) return null
  const endpoint = script.dataset.endpoint
  if (endpoint == null) return null
  return {
    endpoint,
    cdnHosts: splitAttribute(script.dataset.cdnHosts),
    downloadExtensions: splitAttribute(script.dataset.downloadExtensions),
    ignoredPathPrefixes: splitAttribute(script.dataset.ignorePrefixes),
    countSearchChanges: script.dataset.countSearch === 'true',
    countHashChanges: script.dataset.countHash === 'true',
  }
}

function send(endpoint: string, kind: 'page' | 'download', path: string): void {
  try {
    if (localStorage.getItem(ANALYTICS_IGNORE_STORAGE_KEY) != null) return
    const blob = new Blob([JSON.stringify({ v: 1, kind, path, ref: document.referrer })], {
      type: 'text/plain',
    })
    if (navigator.sendBeacon?.(endpoint, blob) === true) return
    void fetch(endpoint, { method: 'POST', body: blob, keepalive: true }).catch(() => {})
  } catch {
    // Opt-out checks and transport both fail closed and silent.
  }
}

function isIgnored(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

function splitAttribute(value: string | undefined): string[] | undefined {
  if (value == null) return undefined
  return value.slice(0, 2_048).split(',').slice(0, 64)
}

function normalizeSet(
  values: readonly string[] | undefined,
  normalize: (value: string) => string
): Set<string> {
  return new Set((values ?? []).map(normalize).filter(Boolean))
}

function normalizePrefixes(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizePrefix).filter(Boolean))]
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/u, '')
}

function normalizeExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\./u, '')
}

function normalizePrefix(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return ''
  return trimmed.length > 1 ? trimmed.replace(/\/+$/u, '') : trimmed
}

function normalizeEndpoint(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('#')) {
    throw new Error('analytics endpoint must be a same-origin, root-relative path without a hash')
  }

  const url = new URL(trimmed, window.location.origin)
  if (url.origin !== window.location.origin) {
    throw new Error('analytics endpoint must use the page origin')
  }
  return `${url.pathname}${url.search}`
}
