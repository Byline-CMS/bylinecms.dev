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

