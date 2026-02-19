/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'

export const useMediaQuery = (query: string): boolean | null => {
  const [matches, setMatches] = useState<boolean | null>(null)
  useEffect(() => {
    const mediaMatch = window.matchMedia(query)
    if (matches == null) {
      setMatches(mediaMatch.matches)
    }
    const handler = (e: MediaQueryListEvent): void => {
      setMatches(e.matches)
    }
    mediaMatch.addEventListener('change', handler)
    return () => {
      mediaMatch.removeEventListener('change', handler)
    }
  }, [matches, query])

  return matches
}
