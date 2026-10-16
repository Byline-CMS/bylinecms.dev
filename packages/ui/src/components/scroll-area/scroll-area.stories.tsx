import type { Meta } from '@storybook/react-vite'

import { ScrollArea as ScrollAreaComponent } from './scroll-area.js'

const meta: Meta<typeof ScrollAreaComponent> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/ScrollArea',
  component: ScrollAreaComponent,
}

export default meta

const TAGS = Array.from({ length: 50 }).map((_, i, a) => `v1.2.0-beta.${a.length - i}`)

export const ScrollArea = (): React.JSX.Element => {
  return (
    <div style={{ height: '100vh', margin: '2rem 0' }}>
      <ScrollAreaComponent
        style={{ width: '200px', height: '300px', margin: '0 auto', border: '1px solid #ccc' }}
      >
        <div style={{ padding: '15px 20px' }}>
          <div>Tags</div>
          {TAGS.map((tag) => (
            <div key={tag}>{tag}</div>
          ))}
        </div>
      </ScrollAreaComponent>
    </div>
  )
}
