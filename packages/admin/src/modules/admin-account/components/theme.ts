/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Client-side colour-theme control for the self-service account.
 *
 * Reads and writes Byline's host theme contract — the same convention
 * the host's blocking `EarlyThemeDetector` script (rendered into
 * `<head>`) and the host ThemeProvider already use:
 *
 *   - `localStorage['theme'] === 'dark' | 'light'` — an explicit choice.
 *   - `localStorage['theme']` absent — follow the OS
 *     (`prefers-color-scheme`), i.e. "system".
 *   - the effective theme is applied as a `.dark` / `.light` class on
 *     `<html>`, plus `style.colorScheme` and the `meta[name=color-scheme]`
 *     content.
 *
 * A choice made here is therefore honoured by the detector on the next
 * load and by the provider on the next route change, and is applied to
 * the live document immediately. Deliberately tiny and dependency-free;
 * if a host ever diverges from this convention, this is the single seam
 * to revisit.
 */

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'
const PREFERS_DARK = '(prefers-color-scheme: dark)'

/** The persisted choice. Absent storage resolves to `'system'`. */
export function getThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system'
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'dark' || stored === 'light' ? stored : 'system'
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PREFERS_DARK).matches
}

/** Apply the effective theme to `<html>`, mirroring the host detector. */
function applyEffectiveTheme(effective: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', effective === 'dark')
  root.classList.toggle('light', effective === 'light')
  root.style.colorScheme = effective
  const meta = document.querySelector('meta[name="color-scheme"]')
  if (meta != null) {
    meta.setAttribute('content', effective === 'dark' ? 'dark light' : 'light dark')
  }
}

/**
 * Persist and apply a theme choice. `'system'` clears the stored
 * override so the document follows `prefers-color-scheme` again.
 */
export function setThemeMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') return
  if (mode === 'system') {
    localStorage.removeItem(STORAGE_KEY)
    applyEffectiveTheme(systemPrefersDark() ? 'dark' : 'light')
  } else {
    localStorage.setItem(STORAGE_KEY, mode)
    applyEffectiveTheme(mode)
  }
}

/**
 * Re-assert the stored theme on the live document without changing it.
 *
 * Byline admin shares the host's theme contract (the `theme` key + the
 * `.dark`/`.light` class on `<html>`), so the surrounding host owns the
 * before-first-paint application. But a host theme provider can re-apply
 * its own (possibly stale, possibly forced) theme on navigation and
 * clobber the admin user's stored choice. Calling this when the admin
 * shell mounts re-applies the stored preference from the single source of
 * truth — `localStorage` — making the admin area self-correcting
 * regardless of how the host manages theme. No-op on the server.
 */
export function applyStoredTheme(): void {
  if (typeof window === 'undefined') return
  const mode = getThemeMode()
  applyEffectiveTheme(mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode)
}
