import { withThemeByClassName } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react-vite'

import '../src/styles/local-fonts.css'
import '../src/styles/reset.css'
import '../src/styles/styles.css'
import '../src/styles/typography.css'
import './preview.css'

import { ToastProvider, ToastViewport } from '../src/components/notifications/toast'
import { DrawerProvider } from '../src/widgets/drawer/drawer-context'

// Scope the iframe, including portals attached to body, without affecting the manager.
document.body.classList.add('byline-ui')

const preview: Preview = {
  tags: ['autodocs'],
  decorators: [
    withThemeByClassName({
      themes: { light: 'light', dark: 'dark' },
      defaultTheme: 'dark',
      parentSelector: 'html',
    }),
    (Story, context) => (
      <DrawerProvider key={context.id}>
        <ToastProvider timeout={5000}>
          <Story />
          <ToastViewport position="bottom-right" />
        </ToastProvider>
      </DrawerProvider>
    ),
  ],
  parameters: {
    layout: 'padded',
    options: {
      storySort: {
        method: 'alphabetical',
        order: [
          'Base',
          'Theme',
          'Typography',
          'Components',
          'Animation',
          'Icons',
          'Loaders',
          'Widgets',
        ],
      },
    },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/ },
    },
  },
}

export default preview
