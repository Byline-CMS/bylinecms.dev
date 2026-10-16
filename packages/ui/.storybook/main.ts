import { createRequire } from 'node:module'
import { dirname } from 'node:path'

import type { StorybookConfig } from '@storybook/react-vite'

const require = createRequire(import.meta.url)
const packagePath = (name: string): string => dirname(require.resolve(`${name}/package.json`))

const config: StorybookConfig = {
  framework: {
    name: packagePath('@storybook/react-vite'),
    options: {},
  },
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    packagePath('@storybook/addon-links'),
    packagePath('@storybook/addon-a11y'),
    packagePath('@storybook/addon-themes'),
    packagePath('@storybook/addon-docs'),
  ],
  staticDirs: ['../public'],
}

export default config
