import type React from 'react'

import type { Meta } from '@storybook/react-vite'

import { Section } from '../section/section.js'
import { Container as ContainerComponent } from './container.js'

const meta: Meta<typeof ContainerComponent> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Container',
  component: ContainerComponent,
}

export default meta

export const Container = (): React.JSX.Element => {
  return (
    <Section style={{ height: '100vh', margin: '2rem auto' }}>
      <ContainerComponent
        className="primary-strong"
        style={{
          height: '400px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p>I'm in a container with shy edges.</p>
      </ContainerComponent>
    </Section>
  )
}
