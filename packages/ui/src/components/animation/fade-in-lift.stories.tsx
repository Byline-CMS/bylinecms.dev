import type React from 'react'

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Section } from '../section/section.js'
import { FadeInLift } from './fade-in-lift.js'

const meta: Meta<typeof FadeInLift> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Animation/FadeInLift',
  component: FadeInLift,
}

export default meta

type Story = StoryObj<typeof FadeInLift>

const DivDemo = (): React.JSX.Element => {
  return (
    <div style={{ marginLeft: '4rem', marginBottom: '4rem' }}>
      <Section style={{ height: '100vh' }}>
        <FadeInLift
          as="div"
          duration={1}
          delay={0.5}
          style={{
            width: '400px',
            height: '400px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--primary-500)',
          }}
        >
          <p style={{ color: 'black' }}>Fade me in 1!</p>
        </FadeInLift>
      </Section>
      <Section style={{ height: '100vh' }}>
        <FadeInLift
          as="span"
          duration={1}
          delay={0.2}
          style={{
            width: '400px',
            height: '400px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--secondary-500)',
          }}
        >
          <p style={{ color: 'black' }}>Fade me in 2!</p>
        </FadeInLift>
      </Section>
      <Section style={{ height: '100vh' }}>
        <FadeInLift
          duration={1}
          delay={0.2}
          style={{
            width: '400px',
            height: '400px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--yellow-500)',
          }}
        >
          <p style={{ color: 'black' }}>Fade me in 3!</p>
        </FadeInLift>
      </Section>
    </div>
  )
}

export const Default: Story = {
  render: () => <DivDemo />,
}
