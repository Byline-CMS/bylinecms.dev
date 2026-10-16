import type { Meta } from '@storybook/react-vite'

export const Quote = (): React.JSX.Element => {
  return (
    <div style={{ marginBottom: '48px' }}>
      <div style={{ maxWidth: '700px', margin: '2rem auto' }} className="prose">
        <h1>Heading 1</h1>
        <p>
          This is a paragraph of text that we&apos;ll use for our typography storybook page. This is
          a paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page.
        </p>
        <blockquote>
          This is some text inside a blockquote. We&apos;ll make this a little longer to see how it
          looks when it wraps.
        </blockquote>
        <p>
          This is a paragraph of text that we&apos;ll use for our typography storybook page. This is
          a paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page.
        </p>
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
  component: Quote,
}

export default meta
