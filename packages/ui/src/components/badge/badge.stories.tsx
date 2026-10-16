import type { Meta, StoryObj } from '@storybook/react-vite'

import { capitalize } from '../../utils/capitalize.js'
import { intent } from '../@types/shared.js'
import { Badge } from './badge.js'

type Story = StoryObj<typeof Badge>

const AllIntents = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto' }}>
      {intent.map((i) => {
        return (
          <div
            key={i}
            style={{
              marginBottom: '12px',
            }}
          >
            <Badge key={`${i}`} intent={i}>{`${capitalize(i)}`}</Badge>
          </div>
        )
      })}
    </div>
  )
}

export const Intents: Story = {
  render: () => <AllIntents />,
}

const meta: Meta<typeof Badge> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Badge',
  component: Badge,
}

export default meta
