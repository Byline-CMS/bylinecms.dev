import type { Plugin } from 'postcss'

const layers =
  'base, byline-base, theme, byline-theme, byline-functional, byline-typography, components, byline-components, overrides, byline-utilities, utilities'
const componentLayers = 'byline-components.primitives, byline-components.cms'

/** Low-to-high precedence for ordinary declarations, shared by packages and hosts. */
export const BYLINE_LAYER_ORDER = `@layer ${layers}; @layer ${componentLayers};`

/**
 * Reserve parent layers and the primitive/CMS sublayers before each stylesheet
 * is hashed by the host bundler. Also render BYLINE_LAYER_ORDER early in the
 * document head for injected CSS. Repeated declarations are harmless, but an
 * existing partial order cannot be repaired after the browser has seen it.
 * This entry does not import the React component graph at runtime.
 */
export function bylineLayerOrder(): Plugin {
  return {
    postcssPlugin: 'byline-layer-order',
    Once(root, { AtRule }) {
      root.prepend(new AtRule({ name: 'layer', params: componentLayers }))
      root.prepend(new AtRule({ name: 'layer', params: layers }))
    },
  }
}
