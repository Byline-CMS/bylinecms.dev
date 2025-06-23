// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type React from 'react'

import type { Meta, StoryObj } from '@storybook/react-vite'

import { type Intent, intent } from '../@types/shared.js'

import { Alert as AlertComponent } from './alert.js'

export const Alerts = (): React.JSX.Element => {
  return (
    <>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        {intent.map((intent: Intent) => {
          if (intent !== 'noeffect') {
            return (
              <div style={{ marginBottom: '1rem' }} key={intent}>
                <AlertComponent intent={intent}>
                  This is a {intent} alert - with some additional text here.
                </AlertComponent>
              </div>
            )
          }
          return null
        })}
        <AlertComponent intent="info" title="This is a title">
          This is an info alert with a title and with some additional text here.
        </AlertComponent>
      </div>
    </>
  )
}

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components',
  component: Alerts,
}

export default meta
