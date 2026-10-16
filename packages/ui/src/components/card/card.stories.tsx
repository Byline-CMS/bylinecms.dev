import type { Meta } from '@storybook/react-vite'

import { Button } from '../button/button.js'
import { Card as CardComponent } from './card.js'

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components',
  component: CardComponent,
}

export default meta

export const Card = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
      <div style={{ marginBottom: '48px' }}>
        <div style={{ maxWidth: '400px', marginBottom: '24px' }}>
          <CardComponent>
            <CardComponent.Header>
              <CardComponent.Title>
                <h2>Normal Card</h2>
              </CardComponent.Title>
              <CardComponent.Description>
                <p>Card description here.</p>
              </CardComponent.Description>
            </CardComponent.Header>
            <CardComponent.Content>
              <p>Card body with some text here.</p>
            </CardComponent.Content>
            <CardComponent.Footer>
              <Button size="sm">A Button</Button>
            </CardComponent.Footer>
          </CardComponent>
        </div>
        <div style={{ maxWidth: '400px', marginBottom: '24px' }}>
          <CardComponent hover={true}>
            <CardComponent.Header>
              <CardComponent.Title>
                <h2>Card Hover</h2>
              </CardComponent.Title>
              <CardComponent.Description>
                <p>Card description here.</p>
              </CardComponent.Description>
            </CardComponent.Header>
            <CardComponent.Content>
              <p>Card body with some text here.</p>
            </CardComponent.Content>
            <CardComponent.Footer>
              <Button size="sm">A Button</Button>
            </CardComponent.Footer>
          </CardComponent>
        </div>
      </div>
    </div>
  )
}
