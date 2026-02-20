/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { Container, Section } from '@infonomic/uikit/react'
import { allExpanded, darkStyles, JsonView } from 'react-json-view-lite'

import { ViewMenu } from './view-menu'
import 'react-json-view-lite/dist/index.css'

export const ApiView = ({
  collectionDefinition,
  initialData,
}: {
  collectionDefinition: CollectionDefinition
  initialData: AnyCollectionSchemaTypes['UpdateType']
}) => {
  const { labels, path } = collectionDefinition

  return (
    <Section>
      <Container>
        <div className="item-view flex flex-col sm:flex-row justify-start sm:justify-between mb-2">
          <h2 className="mb-2">{labels.singular} API</h2>
          <ViewMenu
            collection={path}
            documentId={String(initialData.document_id)}
            activeView="api"
          />
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
