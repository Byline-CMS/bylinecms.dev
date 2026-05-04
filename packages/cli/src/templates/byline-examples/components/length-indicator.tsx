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
import { Fragment, useEffect, useState } from 'react'

import { Pill } from './pill'

export const LengthIndicator: React.FC<{
  maxLength?: number
  minLength?: number
  text?: string
}> = (props) => {
  const { maxLength = 0, minLength = 0, text } = props

  const [labelStyle, setLabelStyle] = useState({
    backgroundColor: '',
    color: '',
  })

  const [label, setLabel] = useState('')
  const [barWidth, setBarWidth] = useState<number>(0)

  useEffect(() => {
    const textLength = text?.length ?? 0

    if (textLength === 0) {
      setLabel('Missing')
      setLabelStyle({
        backgroundColor: 'red',
        color: 'white',
      })
      setBarWidth(0)
    } else {
      const progress = (textLength - minLength) / (maxLength - minLength)

      if (progress < 0) {
        const ratioUntilMin = textLength / minLength

        if (ratioUntilMin > 0.9) {
          setLabel('Almost there')
          setLabelStyle({
            backgroundColor: 'orange',
            color: 'white',
          })
        } else {
          setLabel('Too short')
          setLabelStyle({
            backgroundColor: 'orangered',
            color: 'white',
          })
        }

        setBarWidth(ratioUntilMin)
      }

      if (progress >= 0 && progress <= 1) {
        setLabel('Good')
        setLabelStyle({
          backgroundColor: 'green',
          color: 'white',
        })
        setBarWidth(progress)
      }

      if (progress > 1) {
        setLabel('Too long')
        setLabelStyle({
          backgroundColor: 'red',
          color: 'white',
        })
        setBarWidth(1)
      }
    }
  }, [minLength, maxLength, text])

  const textLength = text?.length ?? 0

  const charsUntilMax = maxLength - textLength
  const charsUntilMin = minLength - textLength

  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        width: '100%',
      }}
    >
      <Pill backgroundColor={labelStyle.backgroundColor} color={labelStyle.color} label={label} />
      <div
        style={{
          flexShrink: 0,
          lineHeight: 1,
          marginRight: '10px',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <small>
          {`${text?.length ?? 0}/${minLength}-${maxLength} chars, `}
          {(textLength === 0 || charsUntilMin > 0) && `${charsUntilMin} to go`}
          {charsUntilMin <= 0 && charsUntilMax >= 0 && `${charsUntilMax} left over`}
          {charsUntilMax < 0 && <Fragment>{`${charsUntilMax * -1} too many`}</Fragment>}
        </small>
      </div>
      <div
        style={{
          backgroundColor: '#F3F3F3',
          height: '2px',
          position: 'relative',
          width: '100%',
        }}
      >
        <div
          style={{
            backgroundColor: labelStyle.backgroundColor,
            height: '100%',
            left: 0,
            position: 'absolute',
            top: 0,
            width: `${barWidth * 100}%`,
          }}
        />
      </div>
    </div>
  )
}
