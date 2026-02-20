import { DEFAULT_THEME, Theme, ThemeSource } from '@/ui/theme/utils'
import { PREFERS_DARK_MQ } from './utils'

export interface ThemeSettings {
  theme: Theme
  source: ThemeSource
}

// Isomorphic getTheme function - safe for SSR rendering
export function getTheme(): ThemeSettings {
  // If we're running on the server, return the default theme immediately.
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return {
      theme: DEFAULT_THEME,
      source: ThemeSource.DEFAULT,
    }
  }

  const localStorageTheme = localStorage.getItem('theme')
  if (localStorageTheme != null) {
    return {
      theme: localStorageTheme as Theme,
      source: ThemeSource.STORED,
    }
  }

  const darkThemeMq = window.matchMedia(PREFERS_DARK_MQ)
  if (darkThemeMq.matches) {
    return {
      theme: Theme.DARK,
      source: ThemeSource.HEADER,
    }
  }

  return {
    theme: DEFAULT_THEME,
    source: ThemeSource.DEFAULT,
  }
}
