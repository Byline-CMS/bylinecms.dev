import type React from 'react'

import type { Meta } from '@storybook/react-vite'

import { Button } from '../button/button.js'
import { Tooltip as TooltipComponent } from './tooltip.js'

export const Tooltip = (): React.JSX.Element => {
  return (
    <div
      style={{
        maxWidth: '100px',
        marginLeft: '12rem',
        marginTop: '3rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '46px',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <TooltipComponent text="I'm a tooltip" side="top" sideOffset={8}>
        <Button fullWidth={true} size="sm">
          Top
        </Button>
      </TooltipComponent>
      <TooltipComponent text="I'm a tooltip" side="left" sideOffset={8}>
        <Button fullWidth={true} size="sm">
          Left
        </Button>
      </TooltipComponent>
      <TooltipComponent text="I'm a tooltip" side="right" sideOffset={8}>
        <Button fullWidth={true} size="sm">
          Right
        </Button>
      </TooltipComponent>
      <TooltipComponent text="I'm a tooltip" side="bottom" sideOffset={8}>
        <Button fullWidth={true} size="sm">
          Bottom
        </Button>
      </TooltipComponent>
    </div>
  )
}

const meta: Meta<typeof TooltipComponent> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components',
  component: TooltipComponent,
}

export default meta
