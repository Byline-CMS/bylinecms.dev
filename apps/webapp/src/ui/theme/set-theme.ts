import type { Theme } from './utils'

export function setTheme(theme: Theme): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem('theme', theme as string)
}
