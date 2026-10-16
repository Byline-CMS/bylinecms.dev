// biome-ignore lint/style/useImportType: <explanation>
import React from 'react'

import { Search } from './search.js'

export default {
  title: 'Widgets/Search',
  component: Search,
  argTypes: {},
}

export const Default = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
      <Search variant="underlined" />
    </div>
  )
}
