/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'

import { useFieldValue } from '@byline/admin/react'
import type { FieldAdornmentSlotProps } from '@byline/core'

import { parseVideoEmbedId, type VideoEmbedProvider } from '@/lib/video-embed-url'
import styles from './video-embed-preview.module.css'

/**
 * Live thumbnail for the `videoEmbedBlock` URL field, rendered in the
 * `afterField` slot.
 *
 * A pasted URL is opaque — the id is buried in query parameters and a typo
 * only shows up on the published page. This resolves the same id the front-end
 * serializer will use (`parseVideoEmbedId`, shared deliberately) and shows the
 * provider's own thumbnail, so a mismatch between the selected type and the
 * pasted URL is visible while editing.
 *
 * A thumbnail rather than legacy's embedded player: it is one image request
 * instead of a third-party player bundle loaded inside the CMS, and it answers
 * the same question — "is this the right video?".
 */
export function VideoEmbedPreview({ path }: FieldAdornmentSlotProps) {
  // `path` is this field's dot-path (`content.2.url`); the provider lives
  // beside it in the same block instance.
  const typePath = `${path.slice(0, path.lastIndexOf('.'))}.type`
  const provider = useFieldValue<VideoEmbedProvider>(typePath)
  const url = useFieldValue<string>(path)

  const videoID = parseVideoEmbedId(provider, url)
  const vimeoThumbnail = useVimeoThumbnail(provider === 'vimeo' ? videoID : undefined)

  if (provider == null) {
    return <Frame>Select a video type.</Frame>
  }

  if (url == null || url.trim().length === 0) {
    return <Frame>Paste a {provider === 'vimeo' ? 'Vimeo' : 'YouTube'} URL.</Frame>
  }

  if (videoID == null) {
    return (
      <Frame tone="warning">
        Not a recognized {provider === 'vimeo' ? 'Vimeo' : 'YouTube'} URL.
      </Frame>
    )
  }

  if (provider === 'youtube') {
    return (
      <Frame>
        <img
          src={`https://img.youtube.com/vi/${videoID}/hqdefault.jpg`}
          alt="YouTube video thumbnail"
          className={styles.thumbnail}
          loading="lazy"
        />
      </Frame>
    )
  }

  if (vimeoThumbnail === 'loading') return <Frame>Loading thumbnail…</Frame>
  if (vimeoThumbnail === 'error') {
    return <Frame tone="warning">Could not load the Vimeo thumbnail.</Frame>
  }

  return (
    <Frame>
      <img
        src={vimeoThumbnail}
        alt="Vimeo video thumbnail"
        className={styles.thumbnail}
        loading="lazy"
      />
    </Frame>
  )
}

function Frame({
  children,
  tone,
}: {
  children: React.ReactNode
  tone?: 'warning'
}): React.JSX.Element {
  return (
    <div className={tone === 'warning' ? `${styles.frame} ${styles.warning}` : styles.frame}>
      {children}
    </div>
  )
}

/**
 * Vimeo exposes no predictable thumbnail URL, so the id has to be resolved
 * through its public oEmbed endpoint. YouTube needs no equivalent — its
 * thumbnails are addressable directly from the id.
 */
function useVimeoThumbnail(videoID: string | undefined): string | 'loading' | 'error' | undefined {
  const [state, setState] = useState<string | 'loading' | 'error' | undefined>(undefined)

  useEffect(() => {
    if (videoID == null) {
      setState(undefined)
      return
    }

    const controller = new AbortController()
    setState('loading')

    fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${videoID}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('oembed'))))
      .then((data: { thumbnail_url?: string }) => {
        setState(data.thumbnail_url ?? 'error')
      })
      .catch((error: unknown) => {
        // An abort is the effect cleaning up after a newer URL, not a failure.
        if (controller.signal.aborted) return
        console.error('Vimeo thumbnail lookup failed:', error)
        setState('error')
      })

    return () => controller.abort()
  }, [videoID])

  return state
}
