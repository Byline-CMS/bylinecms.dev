/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * URL parsing for `videoEmbedBlock`, shared by the front-end serializer and
 * the admin preview slot so the CMS never shows an embed the site cannot
 * render. The Lexical `youtube` / `vimeo` nodes do not come through here —
 * those store a bare `videoID` extracted at authoring time.
 */

export type VideoEmbedProvider = 'youtube' | 'vimeo'

/** Accepts watch, short, embed and live URLs. YouTube ids are 11 chars. */
const YOUTUBE_ID =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?|live|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/

const VIMEO_ID = /vimeo\.com\/(?:video\/)?(\d+)/

/**
 * Extract the provider's video id from a pasted page URL.
 *
 * `provider` comes from the block's own `type` field; the id pattern is
 * checked against that provider only, so a Vimeo URL saved against
 * `type: 'youtube'` returns `undefined` rather than a broken embed.
 */
export function parseVideoEmbedId(
  provider: VideoEmbedProvider | undefined,
  url: string | undefined | null
): string | undefined {
  if (url == null || url.trim().length === 0) return undefined
  const match = provider === 'vimeo' ? url.match(VIMEO_ID) : url.match(YOUTUBE_ID)
  return match?.[1]
}

/** Privacy-preserving player URL for an extracted id. */
export function videoEmbedSrc(provider: VideoEmbedProvider, videoID: string): string {
  return provider === 'vimeo'
    ? `https://player.vimeo.com/video/${videoID}`
    : `https://www.youtube-nocookie.com/embed/${videoID}`
}
