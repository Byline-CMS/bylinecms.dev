'use client'

/**
 * Portions Copyright (c) Payload CMS, LLC info@payloadcms.com
 * Copyright notices appear at the top of source files where applicable
 * and are licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree
 *
 * https://github.com/payloadcms/payload/
 * From the Payload SEO plugin
 * https://github.com/payloadcms/payload/tree/main/packages/plugin-seo
 */
import type React from 'react'

export const Pill: React.FC<{
  backgroundColor: string
  color: string
  label: string
}> = (props) => {
  const { backgroundColor, color, label } = props

  return (
    <div
      style={{
        backgroundColor,
        borderRadius: '2px',
        color,
        flexShrink: 0,
        lineHeight: 1,
        marginRight: '10px',
        padding: '4px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      <small>{label}</small>
    </div>
  )
}
