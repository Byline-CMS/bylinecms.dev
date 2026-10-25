import { useLayoutEffect, useState } from 'react'

import { AdminRow } from '@byline/admin/react'
import { Button, Container, Section } from '@byline/ui/react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import './styles.css'

const utilities =
  'm-0 p-[7px] w-[123px] max-w-[123px] bg-[#123456] text-[19px] leading-[23px] font-normal'
const expected = {
  marginTop: '0px',
  paddingTop: '7px',
  width: '123px',
  maxWidth: '123px',
  backgroundColor: 'rgb(18, 52, 86)',
  fontSize: '19px',
  lineHeight: '23px',
  fontWeight: '400',
}
function Contract() {
  const [context, setContext] = useState('public')
  const [dark, setDark] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [failures, setFailures] = useState<string[]>([])
  const [width, setWidth] = useState(innerWidth)
  useLayoutEffect(() => {
    const resize = () => setWidth(innerWidth)
    addEventListener('resize', resize)
    return () => removeEventListener('resize', resize)
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewport changes must recheck responsive computed styles
  useLayoutEffect(() => {
    document.documentElement.dataset.themeContext = context
    document.documentElement.className = `byline-ui ${dark ? 'dark' : 'light'}`
    const errors: string[] = []
    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-contract], [data-cms] > .byline-admin-row'
    )) {
      const style = getComputedStyle(element)
      if (enabled)
        for (const [property, value] of Object.entries(expected)) {
          if (style[property as keyof CSSStyleDeclaration] !== value)
            errors.push(`${element.dataset.contract ?? 'CMS row'}: ${property}`)
        }
    }
    const portal = document.querySelector('[data-contract=portal]')!
    if (
      (getComputedStyle(portal).getPropertyValue('--contract-brand').trim() === 'public') !==
      (context === 'public')
    )
      errors.push('Portal theme isolation')
    const accessible = getComputedStyle(document.querySelector('[data-accessible]')!)
    if (accessible.position !== 'static') errors.push('not-sr-only must override kit sr-only')
    setFailures(errors)
  }, [context, dark, enabled, width])
  const classes = enabled ? utilities : ''
  return (
    <>
      <nav className="p-4 flex gap-4">
        <button type="button" onClick={() => setContext('public')}>
          public
        </button>
        <button type="button" onClick={() => setContext('admin')}>
          admin
        </button>
        <button type="button" onClick={() => setDark((v) => !v)}>
          Toggle theme
        </button>
        <button type="button" onClick={() => setEnabled((v) => !v)}>
          Toggle utilities
        </button>
      </nav>
      <output data-testid="result" data-pass={failures.length === 0} className="block p-4">
        {context} / {dark ? 'dark' : 'light'} / {enabled ? 'utilities' : 'defaults'}:{' '}
        {failures.length ? failures.join('; ') : 'PASS'}
      </output>
      <Button data-contract="button" className={classes}>
        Button
      </Button>
      <Container data-contract="container" className={classes}>
        Container
      </Container>
      <Section data-contract="section" className={classes}>
        Section
      </Section>
      <div data-cms>
        <AdminRow className={classes}>
          <span>CMS row</span>
        </AdminRow>
      </div>
      <div data-contract="card" className={`host-card ${classes}`}>
        Host card
      </div>
      <article className="prose">
        <p data-contract="prose" className={classes}>
          Prose
        </p>
      </article>
      <span data-accessible className="sr-only not-sr-only">
        Visible with a direct utility
      </span>
      {createPortal(
        <Button data-contract="portal" className={classes}>
          Portal button
        </Button>,
        document.body
      )}
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Contract />)
