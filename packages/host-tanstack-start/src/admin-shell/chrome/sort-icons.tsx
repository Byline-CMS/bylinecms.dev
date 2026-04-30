'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

const DEFAULT_SORT_ICON_CLASS = 'byline-sort-icon'

// Ascending sort icon (A-Z with down arrow)
export function SortAscendingIcon({ className = DEFAULT_SORT_ICON_CLASS }: { className?: string }) {
  return (
    <svg
      role="presentation"
      className={className}
      viewBox="0 0 28 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 4L12 18M12 18L8 14M12 18L16 14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="19"
        y="8"
        fontSize="12"
        fontWeight="bold"
        fill="currentColor"
        fontFamily="Arial, sans-serif"
      >
        A
      </text>
      <text
        x="19"
        y="18"
        fontSize="12"
        fontWeight="bold"
        fill="currentColor"
        fontFamily="Arial, sans-serif"
      >
        Z
      </text>
    </svg>
  )
}

// Descending sort icon (Z-A with up arrow)
export function SortDescendingIcon({
  className = DEFAULT_SORT_ICON_CLASS,
}: {
  className?: string
}) {
  return (
    <svg
      role="presentation"
      className={className}
      viewBox="0 0 28 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 19L12 5M12 5L8 9M12 5L16 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="19"
        y="8"
        fontSize="12"
        fontWeight="bold"
        fill="currentColor"
        fontFamily="Arial, sans-serif"
      >
        Z
      </text>
      <text
        x="19"
        y="18"
        fontSize="12"
        fontWeight="bold"
        fill="currentColor"
        fontFamily="Arial, sans-serif"
      >
        A
      </text>
    </svg>
  )
}

// Unsorted/neutral icon (both arrows with no letters)
export function SortNeutralIcon({ className = DEFAULT_SORT_ICON_CLASS }: { className?: string }) {
  return (
    <svg
      role="presentation"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 10L12 6M12 6L9 9M12 6L15 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.5"
      />
      <path
        d="M12 14L12 18M12 18L9 15M12 18L15 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.5"
      />
    </svg>
  )
}
