import type { Meta } from '@storybook/react-vite'

export const Lists = (): React.JSX.Element => {
  return (
    <div style={{ marginBottom: '48px' }}>
      <div style={{ maxWidth: '700px', margin: '2rem auto' }} className="prose">
        <h1>Lists</h1>
        <p>
          This is a paragraph of text that we&apos;ll use for our typography storybook page. This is
          a paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page.
        </p>
        <ol>
          <li>One - item in a list here</li>
          <li>Two - item in a list here</li>
          <li>Three - item in a list here</li>
          <li>Four - item in a list here</li>
          <li>Five - item in a list here</li>
        </ol>
        <p>
          This is a paragraph of text that we&apos;ll use for our typography storybook page. This is
          a paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page.
        </p>
        <ul>
          <li>Item - item in a list here</li>
          <li>Item - item in a list here</li>
          <li>Item - item in a list here</li>
          <li>Item - item in a list here</li>
          <li>Item - item in a list here</li>
        </ul>
      </div>
    </div>
  )
}

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Typography',
  component: Lists,
}

export default meta
