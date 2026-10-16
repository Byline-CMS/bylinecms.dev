import type { Meta } from '@storybook/react-vite'

export const Default = (): React.JSX.Element => {
  return (
    <div style={{ marginBottom: '48px' }}>
      <div style={{ maxWidth: '700px', margin: '2rem auto' }}>
        <div
          style={{
            padding: '1.25rem',
            boxShadow: 'var(--shadow)',
            border: '1px solid var(--border-color)',
            borderRadius: '0.25rem',
          }}
        >
          <h2>Heading 2</h2>
          <span className="muted">Muted text here.</span>
          <p>
            This is a paragraph of text that we&apos;ll use for our theme Storybook page. This is a
            paragraph of text that has been styled with our default or starter HTML element settings
            from our styles/theme/theme.css source CSS file, and does NOT have &apos;prose&apos;
            applied. Prose is part of our separately installed typography system via
            styles/typography/typography.css - examples of which are available under the Typography
            category in Storybook.
          </p>
        </div>
      </div>
    </div>
  )
}

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Theme',
  component: Default,
}

export default meta
