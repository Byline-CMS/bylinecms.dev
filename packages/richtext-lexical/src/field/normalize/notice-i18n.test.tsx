import { act } from 'react'

import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { AdaptedNotice, UnsupportedContentNotice } from './adapted-notice'

// biome-ignore lint/suspicious/noExplicitAny: React act environment flag
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
})

async function renderWithBundle(
  node: React.ReactNode,
  // biome-ignore lint/suspicious/noExplicitAny: hand-built partial bundle
  bundle: any,
  locale: string
): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(
      <I18nProvider
        bundle={bundle}
        activeLocale={locale}
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', name: 'English' }]}
        onMissing={() => {}}
      >
        {node}
      </I18nProvider>
    )
  })
  return container
}

async function render(node: React.ReactNode, locale?: string): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })

  await act(async () => {
    root.render(
      locale == null ? (
        node
      ) : (
        <I18nProvider
          bundle={adminTranslations({ locales: ['en', 'fr'] })}
          activeLocale={locale}
          defaultLocale="en"
          localeDefinitions={[
            { code: 'en', name: 'English' },
            { code: 'fr', name: 'Français' },
          ]}
        >
          {node}
        </I18nProvider>
      )
    )
  })
  return container
}

describe('notice translation', () => {
  it('renders English without any provider', async () => {
    // The editor can mount outside the admin shell, and `useTranslation`
    // throws when no provider is present — a notice must never be the
    // thing that breaks a field.
    const container = await render(<AdaptedNotice />)
    expect(container.textContent).toContain('no longer supports')
    expect(container.textContent).not.toContain('richtext.adapted.notice')
  })

  it('renders English through the provider', async () => {
    const container = await render(<AdaptedNotice />, 'en')
    expect(container.textContent).toContain('no longer supports')
  })

  it('renders French through the provider', async () => {
    const container = await render(<AdaptedNotice />, 'fr')
    expect(container.textContent).toContain('ne prend plus en charge')
    expect(container.textContent).not.toContain('no longer supports')
  })

  it('translates content names and joins them for the locale', async () => {
    const container = await render(
      <UnsupportedContentNotice unsupportedTypes={['inline-image', 'youtube']} />,
      'fr'
    )
    expect(container.textContent).toContain('une image')
    expect(container.textContent).toContain('YouTube')
    // Joined the way the locale writes a list, not with a bare comma.
    expect(container.textContent).toContain(' et ')
  })

  it('falls back to English when the provider bundle predates these keys', async () => {
    // A site pinned to an older @byline/i18n has a provider but no such
    // key. The formatter's last resort is the raw key, which would put
    // `richtext.adapted.notice` in front of a reader.
    const stale = { en: { 'byline-admin': { 'common.actions.save': 'Save' } } }
    const container = await renderWithBundle(<AdaptedNotice />, stale, 'en')
    expect(container.textContent).toContain('no longer supports')
    expect(container.textContent).not.toContain('richtext.adapted.notice')
  })

  it('keeps an unknown type as its id in any locale', async () => {
    const container = await render(
      <UnsupportedContentNotice unsupportedTypes={['acme-callout']} />,
      'fr'
    )
    expect(container.textContent).toContain('acme-callout')
    expect(container.textContent).toContain('lecture seule')
  })
})
