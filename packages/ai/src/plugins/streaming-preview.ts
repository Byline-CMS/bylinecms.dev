/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export type RollingPreviewOptions = {
  maxChars: number
}

export function appendRollingPreviewText(
  previous: string,
  chunk: string,
  options: RollingPreviewOptions
): string {
  const maxChars = Number.isFinite(options.maxChars) ? Math.max(0, Math.floor(options.maxChars)) : 0
  if (maxChars === 0) return ''

  const safeChunk = normalizePreviewChunk(chunk)
  if (!safeChunk) return previous

  const next = previous + safeChunk
  if (next.length <= maxChars) return next
  return next.slice(next.length - maxChars)
}

function normalizePreviewChunk(chunk: string): string {
  // Keep content “raw” (it’s often JSON fragments), but avoid control chars that can break display.
  return chunk.replaceAll('\u0000', '')
}
