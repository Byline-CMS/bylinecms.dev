'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import React from 'react'

// Ascending sort icon (A-Z with down arrow)
export function SortAscendingIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      role="presentation"
      className={className}
      viewBox="0 0 28 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Down arrow */}
      <path
        d="M12 4L12 18M12 18L8 14M12 18L16 14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* A */}
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
      {/* Z */}
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
export function SortDescendingIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      role="presentation"
      className={className}
      viewBox="0 0 28 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Up arrow */}
      <path
        d="M12 19L12 5M12 5L8 9M12 5L16 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Z */}
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
      {/* A */}
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
export function SortNeutralIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      role="presentation"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Up arrow */}
      <path
        d="M12 10L12 6M12 6L9 9M12 6L15 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.5"
      />
      {/* Down arrow */}
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

// Demo component showing the icons in use
export default function SortIconsDemo() {
  const [sortState, setSortState] = React.useState<'none' | 'asc' | 'desc'>('none')

  const handleSort = () => {
    setSortState((prev) => {
      if (prev === 'none') return 'asc'
      if (prev === 'asc') return 'desc'
      return 'none'
    })
  }

  const getSortIcon = () => {
    switch (sortState) {
      case 'asc':
        return <SortAscendingIcon className="w-6 h-6" />
      case 'desc':
        return <SortDescendingIcon className="w-6 h-6" />
      default:
        return <SortNeutralIcon className="w-6 h-6" />
    }
  }

  return (
    <div className="p-8 space-y-8">
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Sort Icons</h2>

        {/* Individual icons display */}
        <div className="flex items-center gap-8">
          <div className="flex flex-col items-center gap-2">
            <SortAscendingIcon className="w-6 h-6" />
            <span className="text-sm text-muted-foreground">Ascending (A-Z)</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SortDescendingIcon className="w-6 h-6" />
            <span className="text-sm text-muted-foreground">Descending (Z-A)</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <SortNeutralIcon className="w-6 h-6" />
            <span className="text-sm text-muted-foreground">Unsorted</span>
          </div>
        </div>
      </div>

      {/* Interactive table header example */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Interactive Example</h3>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-4 border-b">
                  <button
                    type="button"
                    onClick={handleSort}
                    className="flex items-center gap-2 hover:bg-muted/50 px-2 py-1 rounded transition-colors"
                  >
                    Name
                    {getSortIcon()}
                  </button>
                </th>
                <th className="text-left p-4 border-b">
                  <div className="flex items-center gap-2">
                    Email
                    <SortNeutralIcon />
                  </div>
                </th>
                <th className="text-left p-4 border-b">
                  <div className="flex items-center gap-2">
                    Role
                    <SortNeutralIcon />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-4 border-b">John Doe</td>
                <td className="p-4 border-b">john@example.com</td>
                <td className="p-4 border-b">Admin</td>
              </tr>
              <tr>
                <td className="p-4 border-b">Jane Smith</td>
                <td className="p-4 border-b">jane@example.com</td>
                <td className="p-4 border-b">User</td>
              </tr>
              <tr>
                <td className="p-4">Bob Johnson</td>
                <td className="p-4">bob@example.com</td>
                <td className="p-4">Editor</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">
          Current sort state:{' '}
          <strong>
            {sortState === 'none'
              ? 'Unsorted'
              : sortState === 'asc'
                ? 'Ascending (A-Z)'
                : 'Descending (Z-A)'}
          </strong>
          <br />
          Click the &ldquo;Name&rdquo; column header to cycle through sort states.
        </p>
      </div>
    </div>
  )
}
