/**
 * Tree reads apply the same SQL-compiled beforeRead predicate to structure and
 * hydration. Hidden nodes break an edge; descendants are not promoted.
 */

import {
  AdminAuth,
  createRequestContext,
  createSuperAdminContext,
  type RequestContext,
} from '@byline/auth'
import {
  type BeforeReadHookFn,
  createReadContext,
  defineCollection,
  type IDbAdapter,
} from '@byline/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setupMultiCollectionTestClient } from '../fixtures/setup.js'
import type { BylineClient } from '../../src/index.js'

let currentRequestContext: RequestContext = createSuperAdminContext({ id: 'super' })
let hookCalls = 0

const scopeTree: BeforeReadHookFn = ({ requestContext }) => {
  hookCalls++
  const actor = requestContext.actor
  if (actor instanceof AdminAuth && actor.id === 'super') return
  const id = actor instanceof AdminAuth ? actor.id : '__none__'
  return { tenantId: id, ownerId: id }
}

const suffix = `${Date.now()}-tree-before-read-${Math.floor(Math.random() * 1e6)}`
const treeDefinition = defineCollection({
  path: `tree-before-read-${suffix}`,
  labels: { singular: 'Node', plural: 'Nodes' },
  useAsTitle: 'title',
  useAsPath: 'title',
  tree: true,
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'tenantId', type: 'text', label: 'Tenant' },
    { name: 'ownerId', type: 'text', label: 'Owner' },
  ],
  hooks: { beforeRead: scopeTree },
})

let client: BylineClient
let db: IDbAdapter
let collectionId: string
let root: string
let visible: string
let hiddenOwner: string
let hiddenTenant: string
let leaf: string

function setActor(id: string): void {
  currentRequestContext = createRequestContext({
    actor: new AdminAuth({ id, abilities: [], isSuperAdmin: true }),
    readMode: 'published',
  })
}

beforeAll(async () => {
  const setup = await setupMultiCollectionTestClient([treeDefinition], {
    requestContext: () => currentRequestContext,
  })
  client = setup.client
  db = setup.db
  const resolvedCollectionId = setup.collectionIds[treeDefinition.path]
  if (resolvedCollectionId == null) throw new Error('tree test collection id was not registered')
  collectionId = resolvedCollectionId
  const tree = client.collection(treeDefinition.path)
  const make = async (title: string, tenantId: string, ownerId: string): Promise<string> => {
    const created = await tree.create({ title, tenantId, ownerId })
    await tree.changeStatus(created.documentId, 'published')
    return created.documentId
  }

  root = await make('Root', 'alice', 'alice')
  visible = await make('Visible', 'alice', 'alice')
  hiddenOwner = await make('Hidden owner', 'alice', 'bob')
  hiddenTenant = await make('Hidden tenant', 'bob', 'alice')
  leaf = await make('Leaf', 'alice', 'alice')

  await tree.placeTreeNode(root, { parentDocumentId: null })
  await tree.placeTreeNode(visible, { parentDocumentId: root })
  await tree.placeTreeNode(hiddenOwner, { parentDocumentId: root, beforeDocumentId: visible })
  await tree.placeTreeNode(leaf, { parentDocumentId: hiddenOwner })
  await tree.placeTreeNode(hiddenTenant, { parentDocumentId: root, beforeDocumentId: hiddenOwner })
}, 30_000)

afterAll(async () => {
  await db.commands.collections.delete(collectionId)
})

beforeEach(() => {
  setActor('alice')
  hookCalls = 0
})

describe('tree beforeRead row scoping', () => {
  it('rejects anonymous published contexts that request any-mode tree reads', async () => {
    currentRequestContext = createRequestContext({ actor: null, readMode: 'published' })
    const tree = client.collection(treeDefinition.path)
    await expect(tree.getSubtree({ status: 'any' })).rejects.toMatchObject({
      code: 'ERR_UNAUTHENTICATED',
    })
    await expect(tree.getAncestors(leaf, { status: 'any' })).rejects.toMatchObject({
      code: 'ERR_UNAUTHENTICATED',
    })
    await expect(tree.getTreeParent(leaf, { status: 'any' })).rejects.toMatchObject({
      code: 'ERR_UNAUTHENTICATED',
    })
  })

  it('hides owner/tenant-excluded nodes and does not promote their descendants', async () => {
    const forest = await client
      .collection(treeDefinition.path)
      .getSubtree({ rootDocumentId: root, status: 'any' })

    expect(flatten(forest).map((node) => node.document.fields.title)).toEqual(['Root', 'Visible'])
  })

  it('starts an explicit subtree at a visible node even when its ancestor is hidden', async () => {
    const forest = await client
      .collection(treeDefinition.path)
      .getSubtree({ rootDocumentId: leaf, status: 'any' })
    expect(flatten(forest).map((node) => node.document.fields.title)).toEqual(['Leaf'])
  })

  it('stops ancestors at a hidden parent', async () => {
    const ancestors = await client
      .collection(treeDefinition.path)
      .getAncestors(leaf, { status: 'any' })
    expect(ancestors).toEqual([])
  })

  it('does not leak hidden queried nodes or hidden parent ids', async () => {
    const tree = client.collection(treeDefinition.path)
    await expect(tree.getTreeParent(hiddenOwner, { status: 'any' })).resolves.toEqual({
      placed: false,
      parentDocumentId: null,
      parentVisibility: 'none',
    })
    await expect(tree.getTreeParent(leaf, { status: 'any' })).resolves.toEqual({
      placed: true,
      parentDocumentId: null,
      parentVisibility: 'redacted',
    })
    await expect(tree.getTreeParent(visible, { status: 'any' })).resolves.toEqual({
      placed: true,
      parentDocumentId: root,
      parentVisibility: 'visible',
    })
  })

  it('caches beforeRead across tree reads sharing one ReadContext', async () => {
    const tree = client.collection(treeDefinition.path)
    const readContext = createReadContext()
    await tree.getSubtree({ rootDocumentId: root, status: 'any', _readContext: readContext })
    await tree.getAncestors(visible, { status: 'any', _readContext: readContext })
    await tree.getTreeParent(visible, { status: 'any', _readContext: readContext })
    expect(hookCalls).toBe(1)
  })

  it('supports the standard internal beforeRead bypass on every tree read', async () => {
    const tree = client.collection(treeDefinition.path)
    const forest = await tree.getSubtree({
      rootDocumentId: root,
      status: 'any',
      _bypassBeforeRead: true,
    })
    expect(flatten(forest).map((node) => node.document.fields.title)).toEqual([
      'Root',
      'Visible',
      'Hidden owner',
      'Leaf',
      'Hidden tenant',
    ])
    expect(
      (await tree.getAncestors(leaf, { status: 'any', _bypassBeforeRead: true })).map((d) => d.id)
    ).toEqual([root, hiddenOwner])
    await expect(
      tree.getTreeParent(leaf, { status: 'any', _bypassBeforeRead: true })
    ).resolves.toEqual({
      placed: true,
      parentDocumentId: hiddenOwner,
      parentVisibility: 'visible',
    })
    expect(hookCalls).toBe(0)
  })
})

function flatten(nodes: Array<{ document: any; children: any[] }>): any[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}
