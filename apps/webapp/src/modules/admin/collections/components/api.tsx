/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'

import type { CollectionDefinition } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { Container, Section, Select, SelectItem } from '@infonomic/uikit/react'
import { allExpanded, darkStyles, JsonView } from 'react-json-view-lite'

import { contentLocales } from '~/i18n'
import { ViewMenu } from './view-menu'
import 'react-json-view-lite/dist/index.css'

/** Sentinel value used in the selector to represent "show all locales". */
const ALL_LOCALE = 'all'

export const ApiView = ({
  collectionDefinition,
  initialData,
  locale,
  onLocaleChange,
}: {
  collectionDefinition: CollectionDefinition
  initialData: AnyCollectionSchemaTypes['UpdateType']
  /** Currently active locale from the route search param (undefined → all). */
  locale?: string
  /** Called when the user picks a different locale. */
  onLocaleChange?: (locale: string) => void
}) => {
  const { labels, path } = collectionDefinition
  const [contentLocale, setContentLocale] = useState(locale ?? ALL_LOCALE)

  // Sync internal state when the route re-fetches with a different locale.
  useEffect(() => {
    setContentLocale(locale ?? ALL_LOCALE)
  }, [locale])

  return (
    <Section>
      <Container>
        <div className="item-view flex flex-col sm:flex-row justify-start sm:justify-between mb-2">
          <h2 className="mb-2">{labels.singular} API</h2>
          <ViewMenu
            collection={path}
            documentId={String(initialData.document_id)}
            activeView="api"
            locale={contentLocale === ALL_LOCALE ? undefined : contentLocale}
          />
        </div>
        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm font-medium text-canvas-600 dark:text-canvas-400">
            Content Language:
          </span>
          <Select
            name="contentLocale"
            id="contentLocale"
            className="min-w-[100px]"
            size="xs"
            variant="outlined"
            value={contentLocale}
            onValueChange={(value) => {
              setContentLocale(value)
              onLocaleChange?.(value)
            }}
          >
            <SelectItem value={ALL_LOCALE}>All</SelectItem>
            {contentLocales.map((loc) => (
              <SelectItem key={loc.code} value={loc.code}>
                {loc.label}
              </SelectItem>
            ))}
          </Select>
        </div>
        <div className="border bg-canvas-800 rounded p-1 font-mono text-sm font-weight-normal">
          <JsonView
            data={initialData}
            shouldExpandNode={allExpanded}
            style={{ ...darkStyles, container: 'api-json-view' }}
          />
        </div>
      </Container>
    </Section>
  )
}
