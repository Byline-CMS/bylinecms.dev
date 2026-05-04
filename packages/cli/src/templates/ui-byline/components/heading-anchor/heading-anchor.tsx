'use client'

import type * as React from 'react'

import { formatTextValue } from '@byline/core'
import cx from 'classnames'

import { extractHeadingText } from './utils.ts'
import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

type Heading = Extract<keyof React.JSX.IntrinsicElements, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'>

export function HeadingWithAnchorSerializer({
  node,
}: {
  node: SerializedLexicalNode
}): React.JSX.Element {
  const tag = node?.tag
  const text = extractHeadingText(node?.children)
  const headingId = formatTextValue(text)
  const Element = tag as Heading
  if (tag != null && (tag === 'h4' || tag === 'h5' || tag === 'h6')) {
    return (
      <Element
        id={headingId}
        className="clear-both relative font-normal text-gray-800 dark:text-gray-300"
      >
        {text}
      </Element>
    )
  } else {
    return (
      <Element id={headingId} className="relative clear-both ">
        <a href={`#${headingId}`} className="component--heading-anchor not-prose no-underline">
          <span className="component--heading-anchor-text font-bold text-theme-900 dark:text-white">
            {text}
          </span>
          <span
            className={cx(
              'component--heading-anchor-icon absolute p-0 leading-4 sm:inline-block',
              'right-[-0.125em] top-[-0.4em] m-0 -translate-y-1 translate-x-1 sm:right-auto sm:top-auto',
              'transition-all duration-200 ease-in-out',
              'text-gray-300  hover:text-gray-400 dark:text-gray-700 dark:hover:text-gray-600',
              'aria-hidden="true"'
            )}
          >
            <svg
              aria-hidden="true"
              tabIndex={-1}
              className="inline"
              width="0.85em"
              height="0.85em"
              viewBox="0 0 15 15"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4.62471 4.00001L4.56402 4.00001C4.04134 3.99993 3.70687 3.99988 3.4182 4.055C2.2379 4.28039 1.29846 5.17053 1.05815 6.33035C0.999538 6.61321 0.999604 6.93998 0.999703 7.43689L0.999711 7.50001L0.999703 7.56312C0.999604 8.06003 0.999538 8.3868 1.05815 8.66966C1.29846 9.82948 2.2379 10.7196 3.4182 10.945C3.70688 11.0001 4.04135 11.0001 4.56403 11L4.62471 11H5.49971C5.7759 11 5.99971 10.7762 5.99971 10.5C5.99971 10.2239 5.7759 10 5.49971 10H4.62471C4.02084 10 3.78907 9.99777 3.60577 9.96277C2.80262 9.8094 2.18169 9.21108 2.02456 8.42678C1.98838 8.24809 1.98971 8.02242 1.98971 7.50001C1.98971 6.9776 1.98838 6.75192 2.02456 6.57323C2.18169 5.78893 2.80262 5.19061 3.60577 5.03724C3.78907 5.00225 4.02084 5.00001 4.62471 5.00001H5.49971C5.7759 5.00001 5.99971 4.77615 5.99971 4.50001C5.99971 4.22387 5.7759 4.00001 5.49971 4.00001H4.62471ZM10.3747 4.00001H9.49971C9.22357 4.00001 8.99971 4.22387 8.99971 4.50001C8.99971 4.77615 9.22357 5.00001 9.49971 5.00001H10.3747C10.9786 5.00001 11.2104 5.00225 11.3937 5.03724C12.1968 5.19061 12.8177 5.78893 12.9749 6.57323C13.0111 6.75192 13.0097 6.9776 13.0097 7.50001C13.0097 8.02242 13.0111 8.24809 12.9749 8.42678C12.8177 9.21108 12.1968 9.8094 11.3937 9.96277C11.2104 9.99777 10.9786 10 10.3747 10H9.49971C9.22357 10 8.99971 10.2239 8.99971 10.5C8.99971 10.7762 9.22357 11 9.49971 11H10.3747L10.4354 11C10.9581 11.0001 11.2925 11.0001 11.5812 10.945C12.7615 10.7196 13.701 9.82948 13.9413 8.66966C13.9999 8.3868 13.9998 8.06003 13.9997 7.56312L13.9997 7.50001L13.9997 7.43689C13.9998 6.93998 13.9999 6.61321 13.9413 6.33035C13.701 5.17053 12.7615 4.28039 11.5812 4.055C11.2925 3.99988 10.9581 3.99993 10.4354 4.00001L10.3747 4.00001ZM4.99971 7.50001C4.99971 7.22387 5.22357 7.00001 5.49971 7.00001H9.49971C9.7759 7.00001 9.99971 7.22387 9.99971 7.50001C9.99971 7.77615 9.7759 8.00001 9.49971 8.00001H5.49971C5.22357 8.00001 4.99971 7.77615 4.99971 7.50001Z"
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
              />
            </svg>
          </span>
        </a>
      </Element>
    )
  }
}
