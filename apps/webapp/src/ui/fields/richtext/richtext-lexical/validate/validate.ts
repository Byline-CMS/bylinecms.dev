import type { SerializedEditorState } from 'lexical'

import { hasText } from './hasText'

export const richTextValidate = async (
  value: SerializedEditorState | undefined,
  options: { required?: boolean }
) => {
  // TODO: use i18n client translation provider
  // const { t, required } = options
  const { required } = options

  if (required && hasText(value) === false) {
    return 'validation:required'
  }

  return true
}
