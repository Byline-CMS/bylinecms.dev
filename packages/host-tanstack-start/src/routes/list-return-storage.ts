/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Tab-scoped fallback for the collection editor's return-to-list state.
 *
 * The primary carrier is the `from` URL param (see list-return-state.ts) —
 * pure, shareable, and enough for every in-app navigation. But the preview
 * affordance does a full-page `window.location.assign()` to the public site,
 * which discards the admin URL (and its `from`). When the editor is re-opened
 * from the public preview bar's "Edit" link, that link carries only the
 * collection and document id — no `from` — so the URL alone can no longer say
 * which list page / filter to return to on close.
 *
 * sessionStorage bridges that gap: it survives a full-page navigation within
 * the same tab, is scoped to the tab, and never leaks into shareable URLs. The
 * editor persists `from` whenever it renders with one, keyed by collection +
 * document id, and reads it back only when the URL carries no `from`. Closing
 * or deleting the document consumes (clears) the entry, so a later visit to
 * the same document with no context degrades to the bare list rather than a
 * stale page.
 *
 * Every access is guarded: an absent `sessionStorage` (SSR, privacy modes,
 * quota failures) degrades silently to "no stored state" — never an error.
 */

const KEY_PREFIX = 'byline:list-return:'

/** Resolve `sessionStorage` defensively — absent under SSR, may throw in some
 * sandboxed / privacy contexts. */
function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined
  } catch {
    return undefined
  }
}

function keyFor(collection: string, id: string): string {
  return `${KEY_PREFIX}${collection}:${id}`
}

/** Persist the encoded `from` state for one document. No-op when unavailable. */
export function persistListReturnState(collection: string, id: string, from: string): void {
  if (from.length === 0) return
  const store = storage()
  if (store == null) return
  try {
    store.setItem(keyFor(collection, id), from)
  } catch {
    // Quota exceeded / storage disabled — persistence is best-effort only.
  }
}

/** Read the stored `from` state for one document, or `undefined`. */
export function readListReturnState(collection: string, id: string): string | undefined {
  const store = storage()
  if (store == null) return undefined
  try {
    return store.getItem(keyFor(collection, id)) ?? undefined
  } catch {
    return undefined
  }
}

/** Clear the stored `from` state for one document (on close / delete). */
export function clearListReturnState(collection: string, id: string): void {
  const store = storage()
  if (store == null) return
  try {
    store.removeItem(keyFor(collection, id))
  } catch {
    // Best-effort — nothing to recover if removal fails.
  }
}
