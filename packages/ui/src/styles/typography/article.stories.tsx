import type { Meta } from '@storybook/react-vite'

export const Article = (): React.JSX.Element => {
  return (
    <div style={{ marginBottom: '48px' }}>
      <article style={{ maxWidth: '700px', margin: '2rem auto' }} className="prose">
        <h1>An Article</h1>
        <p>
          This is text that that has been placed in an article element. Text in articles as well as
          within .dynamic-text class selectors will automatically increase in size on mobile devices
          for better readability. This is a paragraph of text that we&apos;ll use for our typography
          storybook page. This is a paragraph of text that we&apos;ll use for our typography
          storybook page.
        </p>
        <blockquote>
          This is some text inside a blockquote. Note that we've used em to size text in the
          blockquote, so that it also changes size in the article.
        </blockquote>
        <p>
          This is a paragraph of text that we&apos;ll use for our typography storybook page. This is
          a paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page. This is a
          paragraph of text that we&apos;ll use for our typography storybook page.
        </p>
      </article>
    </div>
  )
}

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Typography',
  component: Article,
}

export default meta
