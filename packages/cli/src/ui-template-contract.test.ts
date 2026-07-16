import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget, SyntaxKind } from 'ts-morph'
import { describe, expect, it } from 'vitest'

const templates = resolve(dirname(fileURLToPath(import.meta.url)), 'templates')
const project = new Project({ skipAddingFilesFromTsConfig: true })
const generated = project.addSourceFileAtPath(
  resolve(templates, 'byline-examples/generated/collection-types.ts')
)
// Format 2 declares every type inside the `@byline/generated-types`
// declaration-merge block; alias lookups search the whole file.
function generatedTypeAliasOrThrow(name: string) {
  const alias = generated
    .getDescendantsOfKind(SyntaxKind.TypeAliasDeclaration)
    .find((declaration) => declaration.getName() === name)
  if (!alias) throw new Error(`Expected to find type alias named '${name}'.`)
  return alias
}
// The plain-module body of the generated types, for in-memory typecheck
// fixtures: the augmentation block unwrapped to top-level declarations.
function generatedModuleBody(): string {
  const match = generated
    .getFullText()
    .match(/declare module '@byline\/generated-types' \{\n([\s\S]*?)\n\}\n\ndeclare module/)
  if (!match?.[1]) throw new Error('Expected a @byline/generated-types augmentation block.')
  return match[1].replace(/^ {2}/gm, '')
}
const contentTypes = project.addSourceFileAtPath(resolve(templates, 'ui-byline/types/content.ts'))
const renderer = project.addSourceFileAtPath(resolve(templates, 'ui-byline/render-blocks.tsx'))

describe('public block renderer templates', () => {
  it('covers every generated Docs and Pages block discriminant', () => {
    const blockNames = new Set([
      ...contentBlockNames('DocsFields'),
      ...contentBlockNames('PagesFields'),
    ])
    const expectedTypes = [...blockNames].map(blockDiscriminant).sort()
    const switchStatement = renderer
      .getDescendantsOfKind(SyntaxKind.SwitchStatement)
      .find((node) => node.getExpression().getText() === 'block._type')
    const renderedTypes = switchStatement
      ?.getCaseBlock()
      .getClauses()
      .flatMap((clause) => {
        if (!clause.isKind(SyntaxKind.CaseClause)) return []
        const expression = clause.getExpression()
        return expression.isKind(SyntaxKind.StringLiteral) ? [expression.getLiteralValue()] : []
      })
      .sort()

    expect(renderedTypes).toEqual(expectedTypes)
  })

  it('combines both consumers and preserves consumer-specific content in the overlay', () => {
    expect(contentTypes.getTypeAliasOrThrow('ContentBlock').getTypeNodeOrThrow().getText()).toBe(
      'ContentBlockOf<DocsFields> | ContentBlockOf<PagesFields>'
    )
    expect(contentTypes.getTypeAlias('WithPopulatedPhotoBlockContent')).toBeDefined()
  })

  it('typechecks the populated union and consumer-specific overlay contract', () => {
    const typeProject = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: ModuleKind.ESNext,
        moduleResolution: ModuleResolutionKind.Bundler,
        target: ScriptTarget.ES2024,
      },
    })
    typeProject.createSourceFile(
      '/client.ts',
      `
        export interface PopulatedRelation<T> { document?: T }
        export type WithPopulated<F, K extends keyof F, Target> = {
          [P in keyof F]: P extends K ? PopulatedRelation<Target> : F[P]
        }
      `
    )
    typeProject.createSourceFile(
      '/generated.ts',
      `type JsonValue = unknown
       type RelatedDocumentValue = { documentId: string }
       type StoredFileValue = { key: string }
       ${generatedModuleBody()}`
    )
    typeProject.createSourceFile(
      '/content.ts',
      contentTypes
        .getFullText()
        .replace("from '@byline/client'", "from './client.js'")
        .replace("from '@byline/generated-types'", "from './generated.js'")
    )
    typeProject.createSourceFile(
      '/contract.ts',
      `
        import type { WithPopulated } from './client.js'
        import type { DocsFields, MediaFields, PagesFields } from './generated.js'
        import type {
          PopulatedContentBlock,
          WithPopulatedPhotoBlockContent,
        } from './content.js'

        type Equal<Left, Right> =
          (<Value>() => Value extends Left ? 1 : 2) extends
          (<Value>() => Value extends Right ? 1 : 2) ? true : false
        type Assert<Value extends true> = Value
        type ConsumerBlock =
          | NonNullable<DocsFields['content']>[number]
          | NonNullable<PagesFields['content']>[number]
        type PhotoBlock = Extract<ConsumerBlock, { _type: 'photoBlock' }>
        type ExpectedBlock =
          | Exclude<ConsumerBlock, PhotoBlock>
          | WithPopulated<PhotoBlock, 'photo', MediaFields>
        type PagesOnlyBlock = { _id: string; _type: 'pagesOnlyBlock'; heading: string }
        type ExtendedPages = Omit<PagesFields, 'content'> & {
          content?: Array<NonNullable<PagesFields['content']>[number] | PagesOnlyBlock>
        }
        type PopulatedExtendedBlock = NonNullable<
          WithPopulatedPhotoBlockContent<ExtendedPages>['content']
        >[number]

        type PopulatedUnionContract = Assert<Equal<PopulatedContentBlock, ExpectedBlock>>
        type ConsumerOverlayContract = Assert<
          Equal<Extract<PopulatedExtendedBlock, { _type: 'pagesOnlyBlock' }>, PagesOnlyBlock>
        >
      `
    )

    expect(
      typeProject.getPreEmitDiagnostics().map((diagnostic) => diagnostic.getMessageText())
    ).toEqual([])
  })

  it('reports unsupported runtime blocks and returns null', () => {
    const fallback = renderer.getFunctionOrThrow('reportUnsupportedBlock')

    expect(
      fallback
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .some((call) => call.getExpression().getText() === 'console.error')
    ).toBe(true)
    expect(
      fallback
        .getDescendantsOfKind(SyntaxKind.ReturnStatement)
        .some((statement) => statement.getExpression()?.isKind(SyntaxKind.NullKeyword))
    ).toBe(true)
  })
})

function contentBlockNames(collection: 'DocsFields' | 'PagesFields'): string[] {
  const content = generatedTypeAliasOrThrow(collection)
    .getDescendantsOfKind(SyntaxKind.PropertySignature)
    .find((property) => property.getName() === 'content')
  const matches = content
    ?.getTypeNodeOrThrow()
    .getText()
    .matchAll(/\b([A-Z]\w*BlockData)\b/g)

  return [...(matches ?? [])].map((match) => match[1]).filter((name) => name !== undefined)
}

function blockDiscriminant(blockName: string): string {
  const type = generatedTypeAliasOrThrow(blockName)
  const discriminant = type
    .getDescendantsOfKind(SyntaxKind.PropertySignature)
    .find((property) => property.getName() === '_type')
    ?.getTypeNodeOrThrow()

  if (!discriminant?.isKind(SyntaxKind.LiteralType)) {
    throw new Error(`Generated block ${blockName} has no literal _type`)
  }
  const literal = discriminant.getLiteral()
  if (!literal.isKind(SyntaxKind.StringLiteral)) {
    throw new Error(`Generated block ${blockName} has a non-string _type`)
  }
  return literal.getLiteralValue()
}
