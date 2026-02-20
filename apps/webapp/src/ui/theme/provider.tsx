'use client'

import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from '@tanstack/react-router'

import { getTheme as getThemeApi, type ThemeSettings } from './get-theme.ts'
import { setTheme as setThemeApi } from './set-theme.ts'
import {
  DEFAULT_THEME,
  PREFERS_DARK_MQ,
  setPrefersColorScheme,
  setPrefersTheme,
  Theme,
  ThemeSource,
} from './utils.ts'

// ThemeContext
interface ThemeContextType {
  theme: Theme | undefined
  setTheme: (theme: Theme) => void
  getTheme: () => Theme
}
const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
  force?: Theme
}

/**
 * Client-side ThemeProvider that:
 * - lazily initializes from cookies/localStorage via getThemeApi()
 * - reacts to prefers-color-scheme changes when source is HEADER
 * - exposes stable setTheme/getTheme helpers
 */
export function ThemeProvider({ children, force }: ThemeProviderProps): React.JSX.Element {
  // Lazy init runs only on the client during hydration.
  const [themeSettings, setThemeSettings] = useState<ThemeSettings | null>(() => getThemeApi())
  const pathname = useLocation().pathname

  // Subscribe to matchMedia changes so that visitors without a
  // stored preference can have their system preference changes
  // reflected in the UI.
  useEffect(() => {
    if (themeSettings?.source !== ThemeSource.HEADER) return

    const mediaQuery = window.matchMedia(PREFERS_DARK_MQ)
    const handleChange = (ev: MediaQueryListEvent) => {
      const prefers = ev.matches ? Theme.DARK : Theme.LIGHT
      // Update immediate DOM hints to avoid flicker.
      setPrefersTheme(prefers)
      setPrefersColorScheme(prefers)
      // Update provider state using the functional form.
      setThemeSettings((currentSettings) => ({
        ...currentSettings,
        source: ThemeSource.HEADER,
        theme: prefers,
      }))
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [themeSettings?.source])

  // Apply forced theme or re-apply current theme on route changes.
  // In Next.js, a route change may replace the entire HTML document
  // including the html class attributes for theme, without a full page
  // reload, in which case our EarlyThemeDetector script/shim won't run
  // and the previous html classes set by EarlyThemeDetector will be lost,
  // so we need to re-apply the theme. This can happen on route changes
  // to not-found pages, for example.
  // If EarlyThemeDetector hasn't run - this will still cause a FOUC,
  // but better than showing the wrong theme.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run on pathname changes
  useEffect(() => {
    const currentTheme = themeSettings?.theme ?? DEFAULT_THEME
    const source = themeSettings?.source

    // Only force the theme if the user has not already stored a preference
    // in localStorage.
    if (force != null && source !== ThemeSource.STORED) {
      setThemeApi(force)
      setPrefersTheme(force)
      setPrefersColorScheme(force)
      setThemeSettings({
        source: ThemeSource.STORED,
        theme: force,
      })
    } else {
      // Re-apply the current theme to the document.
      setPrefersTheme(currentTheme)
      setPrefersColorScheme(currentTheme)
    }
  }, [pathname, force, themeSettings]) // Runs on every route change

  // Persist + apply a user-selected theme.
  const setTheme = useCallback((prefers: Theme) => {
    // Persist asynchronously (e.g., set localStorage).
    setThemeApi(prefers)
    // Immediate optimistic UI update (no waiting for network).
    setPrefersTheme(prefers)
    setPrefersColorScheme(prefers)
    // Mark source as STORED (user override).
    setThemeSettings({ theme: prefers, source: ThemeSource.STORED })
  }, [])

  // Read the active theme with a safe default.
  const getTheme = useCallback<() => Theme>(() => {
    return themeSettings?.theme ?? DEFAULT_THEME
  }, [themeSettings])

  // Keep the context value identity as stable as possible.
  const contextValue = useMemo<ThemeContextType>(
    () => ({
      theme: themeSettings?.theme,
      setTheme,
      getTheme,
    }),
    [themeSettings?.theme, setTheme, getTheme]
  )

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>
}

// Hook helper useTheme
export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext)
  if (ctx == null) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}
