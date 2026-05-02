/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { adminSignOut, type CurrentAdminUser } from '@byline/host-tanstack-start/server-fns/auth'
import {
  disablePreviewModeFn,
  enablePreviewModeFn,
} from '@byline/host-tanstack-start/server-fns/preview'
import {
  Button,
  Chip,
  DocumentIcon,
  EditIcon,
  EyeClosedIcon,
  EyeOpenIcon,
  InfonomicIcon,
  SignOutIcon,
} from '@infonomic/uikit/react'

export type ContentAdminBarProps = {
  user: CurrentAdminUser | null
  /**
   * Admin URL prefix (e.g. `/admin`). The host should resolve this from
   * the configured `routes.admin` via `resolveRoutes()` and thread it
   * down — there is no default here on purpose, so a non-default admin
   * mount point can never silently 404 the bar's links.
   */
  admin: string
  /**
   * Whether the `byline_preview` cookie is currently set on this request.
   * The public layout loader resolves it via `getPreviewStateFn()` and
   * threads it down. The bar always renders a selectable "Preview ON / OFF"
   * Chip while the admin is signed in — `preview` controls its initial
   * selected state. Toggling the Chip flips the cookie and re-runs the
   * loader so any drafts on screen revert to / appear from published.
   */
  preview?: boolean
  lng?: string
}

export function ContentAdminBar({ user, admin, preview = false }: ContentAdminBarProps) {
  const router = useRouter()
  const [collection, setCollection] = useState<string>()
  const [id, setId] = useState<string>()
  const [signingOut, setSigningOut] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)

  // Observe the DOM for `byline-cms-meta` rather than keying off
  // `location.pathname` — the meta div is owned by child routes inside the
  // <Outlet />, and effect timing across transitions / suspense boundaries
  // is not reliable enough to guarantee we read the new route's div on the
  // first pass. A MutationObserver fires on any insert/remove/attr change,
  // so the bar stays in sync regardless of when the child route commits.
  useEffect(() => {
    const sync = () => {
      const meta = document.getElementById('byline-cms-meta')
      setCollection(meta?.getAttribute('data-collection') ?? undefined)
      setId(meta?.getAttribute('data-id') ?? undefined)
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-collection', 'data-id', 'id'],
    })
    return () => observer.disconnect()
  }, [])

  if (user == null) return null

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await adminSignOut()
    } catch (err) {
      console.warn('sign-out request failed', err)
    }
    // Re-run the public layout loader so `user` becomes null and the bar hides.
    await router.invalidate()
    setSigningOut(false)
  }

  async function handlePreviewToggle(next: boolean) {
    if (previewBusy) return
    setPreviewBusy(true)
    try {
      if (next) {
        await enablePreviewModeFn()
      } else {
        await disablePreviewModeFn()
      }
    } catch (err) {
      console.warn('preview toggle failed', err)
    }
    // Re-run the public layout loader so `preview` reflects the new state.
    // Any draft-aware server fn currently feeding content on the page (e.g.
    // news) also re-evaluates, so drafts appear / revert to published in
    // one round trip.
    await router.invalidate()
    setPreviewBusy(false)
  }

  const { email, id: userID } = user

  return (
    <div className="flex gap-2 text-sm items-center w-full z-10 py-[4px] px-[16px] bg-[#e3b836] text-[#222]">
      <a href={`${admin}`} className="h-[22px] w-[22px] mr-2">
        <InfonomicIcon />
      </a>
      <a
        href={`${admin}/users/${userID}`}
        style={{
          marginRight: '10px',
          display: 'block',
          minWidth: '50px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          color: 'inherit',
        }}
      >
        <span
          style={{
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
          }}
        >
          {email || 'Profile'}
        </span>
      </a>
      <div
        className="not-dark"
        style={{
          display: 'flex',
          gap: '12px',
          flexShrink: 1,
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        <Button
          className="min-w-[36px] text-black dark:text-black focus:ring-0 focus:ring-offset-0"
          intent="primary"
          variant="outlined"
          size="xs"
          disabled={previewBusy}
          onClick={() => {
            void handlePreviewToggle(!preview)
          }}
          title={
            preview
              ? 'Drafts are visible — click to return to the published view'
              : 'Click to surface in-progress drafts on the public site'
          }
        >
          {preview ? (
            <EyeOpenIcon width="16px" height="16px" />
          ) : (
            <EyeClosedIcon width="16px" height="16px" />
          )}
          <span className="hidden sm:block">Preview</span>
        </Button>
        {collection && id && (
          <Button
            render={
              // biome-ignore lint/a11y/useAnchorContent: Screen readers will read the aria-label, and the link text is visually hidden to avoid redundancy.
              <a href={`${admin}/collections/${collection}/${id}`} aria-label="Edit document" />
            }
            variant="outlined"
            size="xs"
            className="min-w-[36px] text-black dark:text-black focus:ring-0 focus:ring-offset-0"
          >
            <span>
              <EditIcon
                svgClassName="stroke-gray-800 dark:stroke-gray-800"
                height="16px"
                width="16px"
              />
            </span>
            <span className="hidden sm:block">Edit</span>
          </Button>
        )}
        {collection && (
          <Button
            render={
              // biome-ignore lint/a11y/useAnchorContent: Screen readers will read the aria-label, and the link text is visually hidden to avoid redundancy.
              <a
                href={`${admin}/collections/${collection}/create`}
                aria-label="Create new document"
              />
            }
            variant="outlined"
            size="xs"
            className="min-w-[36px] text-black dark:text-black focus:ring-0 focus:ring-offset-0"
          >
            <span>
              <DocumentIcon
                svgClassName="stroke-gray-800 dark:stroke-gray-800"
                height="16px"
                width="16px"
              />
            </span>
            <span className="hidden sm:block">Create New</span>
          </Button>
        )}
      </div>
      <Button
        onClick={handleSignOut}
        disabled={signingOut}
        variant="outlined"
        size="xs"
        className="not-dark min-w-[36px] text-black dark:text-black focus:ring-0 focus:ring-offset-0"
      >
        <span>
          <SignOutIcon
            svgClassName="stroke-gray-800 dark:stroke-gray-800"
            height="16px"
            width="16px"
          />
        </span>
        <span className="hidden sm:block">{signingOut ? 'Signing out…' : 'Log out'}</span>
      </Button>
    </div>
  )
}
