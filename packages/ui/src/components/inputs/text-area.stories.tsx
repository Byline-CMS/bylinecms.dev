import type React from 'react'

import { TextArea } from './index.js'

export default {
  title: 'Components/Inputs/TextArea',
  component: TextArea,
  argTypes: {},
}

export const Default = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
      <TextArea
        required
        id="message"
        name="message"
        rows={5}
        label="Message"
        helpText="Please enter a message."
        disabled={false}
        error={false}
      />
    </div>
  )
}

// biome-ignore lint/suspicious/noShadowRestrictedNames: <explanation>
export const Error = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
      <TextArea
        required
        id="message"
        name="message"
        rows={5}
        label="Message"
        helpText="Please enter a message."
        disabled={false}
        error={true}
        errorText="Messages must be longer than 15 characers..."
      />
    </div>
  )
}
