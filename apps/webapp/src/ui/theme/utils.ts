enum Theme {
  DARK = 'dark',
  LIGHT = 'light',
}

enum ThemeSource {
  STORED = 'stored',
  HEADER = 'header',
  DEFAULT = 'default',
}

const PREFERS_DARK_MQ = '(prefers-color-scheme: dark)'
const DEFAULT_THEME = Theme.LIGHT
const DEFAULT_COLOR_SCHEME = 'light dark'

function getPrefers(): Theme {
  if (typeof document !== 'undefined') {
    const prefers = window.matchMedia(PREFERS_DARK_MQ).matches ? Theme.DARK : Theme.LIGHT
    if (prefers != null) {
      return prefers
    }
    return DEFAULT_THEME
  }
  return DEFAULT_THEME
}

function getPrefersTheme(theme: Theme | null): Theme {
  if (theme != null) {
    return theme
  }
  return getPrefers()
}

function setPrefersTheme(theme: Theme | null): Theme {
  const prefers = getPrefersTheme(theme)
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.classList.toggle('dark', prefers === 'dark')
    root.classList.toggle('light', prefers === 'light')
    // Set colorScheme style property to match theme
    root.style.colorScheme = prefers
  }
  return prefers
}

function getPrefersColorScheme(theme: Theme | null): 'light dark' | 'dark light' {
  let prefers: Theme
  if (theme != null) {
    prefers = theme
  } else {
    prefers = getPrefers()
  }
  return prefers === 'dark' ? 'dark light' : 'light dark'
}

function setPrefersColorScheme(theme: Theme | null): void {
  let prefers: Theme
  if (theme != null) {
    prefers = theme
  } else {
    prefers = getPrefers()
  }
  if (typeof document !== 'undefined') {
    const meta: any = document.querySelector('meta[name=color-scheme]')
    if (meta != null) {
      if (prefers === 'dark') {
        meta.content = 'dark light'
      } else if (prefers === 'light') {
        meta.content = 'light dark'
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn('meta tag name="color-scheme" not found')
    }
  }
}

function setPrefersSystem(): void {
  if (typeof document !== 'undefined') {
    const head = document.documentElement
    if (head.dataset.themeNoprefs === 'true') {
      const prefers = getPrefers()
      head.classList.toggle('dark', prefers === Theme.DARK)
      head.classList.toggle('light', prefers === Theme.LIGHT)

      const meta: any = document.querySelector('meta[name=color-scheme]')
      if (meta != null) {
        if (prefers === 'dark') {
          meta.content = 'dark light'
        } else if (prefers === 'light') {
          meta.content = 'light dark'
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn('meta tag name="color-scheme" not found')
      }
    }
  }
}

// Helper to type check Theme value
const themes: Theme[] = Object.values(Theme)
function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && themes.includes(value as Theme)
}

export {
  Theme,
  ThemeSource,
  DEFAULT_THEME,
  DEFAULT_COLOR_SCHEME,
  PREFERS_DARK_MQ,
  getPrefers,
  getPrefersTheme,
  setPrefersTheme,
  getPrefersColorScheme,
  setPrefersColorScheme,
  setPrefersSystem,
  isTheme,
}
