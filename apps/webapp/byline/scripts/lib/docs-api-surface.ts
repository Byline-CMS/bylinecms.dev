/**
 * Typed inventory for the exhaustive API reference pages.
 *
 * Each key list is checked in both directions:
 * - every listed value must exist on the current public type; and
 * - every public key/type discriminator must appear in the list.
 *
 * `docs-check` also requires every listed token to occur in its reference
 * source. This does not generate prose; it makes a public-surface change fail
 * the docs gate until a developer updates the human-written reference.
 */

import type { BylineClient, BylineClientConfig, CollectionHandle } from '@byline/client'
import type {
  AdminConfig,
  BlockAdminConfig,
  BylineCore,
  CollectionAdminConfig,
  Field,
  MultiCollectionDefinition,
  ServerConfig,
} from '@byline/core'

type StringKeyOf<T> = Extract<keyof T, string>

function completeKeys<T>() {
  return <const Keys extends readonly StringKeyOf<T>[]>(
    keys: Keys &
      ([Exclude<StringKeyOf<T>, Keys[number]>] extends [never]
        ? unknown
        : { readonly __missingKeys: Exclude<StringKeyOf<T>, Keys[number]> })
  ): Keys => keys
}

function completeValues<Value extends string>() {
  return <const Values extends readonly Value[]>(
    values: Values &
      ([Exclude<Value, Values[number]>] extends [never]
        ? unknown
        : { readonly __missingValues: Exclude<Value, Values[number]> })
  ): Values => values
}

const adminConfigKeys = completeKeys<AdminConfig>()([
  'i18n',
  'collections',
  'routes',
  'admin',
  'collectionGroups',
  'blockAdmin',
  'slugifier',
  'fields',
])

const serverConfigKeys = completeKeys<ServerConfig>()([
  'i18n',
  'collections',
  'routes',
  'db',
  'hooks',
  'storage',
  'slugifier',
  'uploads',
  'sessionProvider',
  'adminStore',
  'fields',
  'search',
  'scheduledPublication',
  'recurringTasks',
])

const bylineCoreKeys = completeKeys<BylineCore>()([
  'config',
  'collections',
  'db',
  'storage',
  'logger',
  'collectionRecords',
  'getCollectionRecord',
  'abilities',
  'registerAbility',
  'listAbilities',
  'getAbilitiesByGroup',
  'sessionProvider',
  'adminStore',
  'recurringTasks',
])

const collectionDefinitionKeys = completeKeys<MultiCollectionDefinition>()([
  'singleton',
  'labels',
  'label',
  'path',
  'fields',
  'workflow',
  'hooks',
  'search',
  'listSearch',
  'useAsTitle',
  'useAsPath',
  'advertiseLocales',
  'buildDocumentPath',
  'linksInEditor',
  'showStats',
  'orderable',
  'tree',
  'version',
])

const collectionAdminConfigKeys = completeKeys<CollectionAdminConfig>()([
  'slug',
  'group',
  'columns',
  'defaultSort',
  'itemView',
  'itemViewSort',
  'defaultColumns',
  'tabSets',
  'rows',
  'groups',
  'layout',
  'fields',
  'preview',
  'listView',
  'listActions',
])

const blockAdminConfigKeys = completeKeys<BlockAdminConfig>()(['blockType', 'fields'])

const fieldTypes = completeValues<Field['type']>()([
  'group',
  'array',
  'blocks',
  'text',
  'textArea',
  'code',
  'checkbox',
  'boolean',
  'select',
  'richText',
  'time',
  'date',
  'datetime',
  'float',
  'integer',
  'decimal',
  'counter',
  'json',
  'object',
  'relation',
  'file',
  'image',
])

const bylineClientConfigKeys = completeKeys<BylineClientConfig>()([
  'config',
  'db',
  'collections',
  'storage',
  'search',
  'richTextToText',
  'contentLocales',
  'logger',
  'defaultLocale',
  'slugifier',
  'richTextPopulate',
  'requestContext',
])

const bylineClientKeys = completeKeys<BylineClient>()([
  'db',
  'collections',
  'storage',
  'logger',
  'defaultLocale',
  'slugifier',
  'richTextPopulate',
  'searchProvider',
  'richTextToText',
  'contentLocales',
  'resolveRequestContext',
  'search',
  'collection',
  'resolveCollectionRecord',
  'resolveCollectionId',
])

const collectionHandleKeys = completeKeys<CollectionHandle>()([
  'find',
  'findOne',
  'search',
  'indexDocument',
  'removeFromIndex',
  'reindex',
  'findById',
  'findByPath',
  'create',
  'update',
  'changeStatus',
  'schedulePublish',
  'confirmScheduledPublish',
  'cancelScheduledPublish',
  'getScheduledPublish',
  'unpublish',
  'restoreVersion',
  'delete',
  'count',
  'countByStatus',
  'history',
  'auditLog',
  'findByVersion',
  'placeTreeNode',
  'removeFromTree',
  'getSubtree',
  'getAncestors',
  'getTreeParent',
])

export interface DocsApiSurfaceSpec {
  fileSuffix: string
  tokens: readonly string[]
}

function unique(...groups: ReadonlyArray<readonly string[]>): string[] {
  return [...new Set(groups.flat())]
}

export const DOCS_API_SURFACE_SPECS: readonly DocsApiSurfaceSpec[] = [
  {
    fileSuffix: '/docs/10-api-reference/01-configuration.md',
    tokens: unique(adminConfigKeys, serverConfigKeys, bylineCoreKeys),
  },
  {
    fileSuffix: '/docs/10-api-reference/02-collections.md',
    tokens: unique(collectionDefinitionKeys, collectionAdminConfigKeys, blockAdminConfigKeys),
  },
  {
    fileSuffix: '/docs/10-api-reference/03-fields.md',
    tokens: fieldTypes,
  },
  {
    fileSuffix: '/docs/10-api-reference/04-client-sdk.md',
    tokens: unique(bylineClientConfigKeys, bylineClientKeys, collectionHandleKeys),
  },
]
