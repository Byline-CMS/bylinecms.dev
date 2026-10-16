import type React from 'react'
import { useState } from 'react'

import type { Meta } from '@storybook/react-vite'

import { Section } from '../section/section.js'
import { Hamburger as HamburgerComponent } from './hamburger.js'

const meta: Meta<typeof HamburgerComponent> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Hamburger',
  component: HamburgerComponent,
}

export default meta

export const Hamburger = (): React.JSX.Element => {
  const [open, setOpen] = useState(false)

  return (
    <Section style={{ height: '100vh', margin: '2rem auto' }}>
      <HamburgerComponent
        open={open}
        onChange={(open) => {
          setOpen(open)
        }}
      />
    </Section>
  )
}
