import type { Meta } from '@storybook/react-vite'

import { Shimmer as ShimmerComponent } from './shimmer.js'

const meta: Meta<typeof ShimmerComponent> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Shimmer',
  component: ShimmerComponent,
}

export default meta

export const Shimmer = (): React.JSX.Element => {
  return (
    <div style={{ height: '100vh' }}>
      <ShimmerComponent variant="text" width="100%" borderRadius="4px" lineHeight="1rem" lines={5}>
        <div style={{ width: '100%' }} />
      </ShimmerComponent>
    </div>
  )
}
