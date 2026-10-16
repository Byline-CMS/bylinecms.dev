import type { Meta } from '@storybook/react-vite'

export const Default = (): React.JSX.Element => {
  return (
    <div style={{ marginBottom: '48px' }}>
      <div style={{ maxWidth: '700px', margin: '2rem auto' }} className="prose">
        <h1>Heading 1 - With Some More Text to Test on Mobile</h1>
        <p>
          This is a paragraph of text that we&apos;ll use for our typography storybook page. This is
          a paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page.
        </p>
        <h2>Heading 2 - With Some More Text to Test on Mobile</h2>
        <p>
          This is a paragraph of text that we&apos;ll use for our typography storybook page. This is
          a paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page.
        </p>
        <h3>Heading 3 - With Some More Text to Test on Mobile</h3>
        <p>
          This is a paragraph of text that we&apos;ll use for our typography storybook page. This is
          a paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page.
        </p>
        <h4>Heading 4 - With Some More Text to Test on Mobile</h4>
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
  component: Default,
}

export default meta
