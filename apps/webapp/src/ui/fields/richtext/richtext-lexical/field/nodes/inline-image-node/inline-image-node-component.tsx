// 'use client'

/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// import * as React from 'react'
// import { Suspense, useCallback, useEffect, useRef, useState } from 'react'

// import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
// import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
// import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
// import { LexicalNestedComposer } from '@lexical/react/LexicalNestedComposer'
// import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
// import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
// import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
// import { mergeRegister } from '@lexical/utils'
// import cx from 'classnames'
// import {
//   $getNodeByKey,
//   $getSelection,
//   $isNodeSelection,
//   $setSelection,
//   CLICK_COMMAND,
//   COMMAND_PRIORITY_LOW,
//   DRAGSTART_COMMAND,
//   KEY_BACKSPACE_COMMAND,
//   KEY_DELETE_COMMAND,
//   KEY_ENTER_COMMAND,
//   KEY_ESCAPE_COMMAND,
//   SELECTION_CHANGE_COMMAND
// } from 'lexical'

// import { $isInlineImageNode } from './inline-image-node'
// import { useSharedHistoryContext } from '../../context/shared-history-context'
// import { useSharedOnChange } from '../../context/shared-on-change-context'
// import { FloatingTextFormatToolbarPlugin } from '../../plugins/floating-text-format-toolbar-plugin/index'
// import { InlineImageModal } from '../../plugins/inline-image-plugin/inline-image-drawer'
// import { getPreferredSize } from '../../plugins/inline-image-plugin/utils'
// import { FloatingLinkEditorPlugin } from '../../plugins/link-plugin/link/floating-link-editor'
// import { LinkPlugin } from '../../plugins/link-plugin/link'
// import ContentEditableInline from '../../ui/content-editable-inline'
// import PlaceholderInline from '../../ui/placeholder-inline'

// import type { InlineImageNode } from './inline-image-node'
// import type { Position, InlineImageAttributes } from './types'
// import type { LexicalEditor, NodeKey, NodeSelection, RangeSelection, BaseSelection } from 'lexical'

// import './inline-image-node-component.css'
// import { InlineImageData } from '../../plugins/inline-image-plugin/types'

// const imageCache = new Set()

// async function useSuspenseImage(src: string): Promise<void> {
//   if (!imageCache.has(src)) {
//     await new Promise((resolve) => {
//       const img = new Image()
//       img.src = src
//       img.onload = () => {
//         imageCache.add(src)
//         resolve(null)
//       }
//     })
//   }
// }

// function LazyImage({
//   id,
//   collection,
//   src,
//   position,
//   altText,
//   className,
//   imageRef,
//   width,
//   height
// }: {
//   id: string
//   collection: string
//   src: string
//   position: Position
//   altText?: string
//   className?: string
//   height?: number | string
//   width?: number | string
//   imageRef: { current: null | HTMLImageElement }
// }): React.JSX.Element {
//   void useSuspenseImage(src)
//   return (
//     // eslint-disable-next-line @next/next/no-img-element
//     <img
//       className={className}
//       src={src}
//       alt={altText}
//       ref={imageRef}
//       width={width}
//       height={height}
//       data-id={id}
//       data-collection={collection}
//       data-position={position}
//       style={{
//         display: 'block'
//       }}
//       draggable="false"
//     />
//   )
// }

// export default function InlineImageComponent({
//   id,
//   collection,
//   src,
//   position,
//   altText,
//   width,
//   height,
//   showCaption,
//   caption,
//   nodeKey
// }: {
//   id: string
//   collection: string
//   src: string
//   position: Position
//   altText?: string
//   height?: number | string
//   width?: number | string
//   showCaption: boolean
//   caption: LexicalEditor
//   nodeKey: NodeKey
// }): React.JSX.Element {
//   const [editor] = useLexicalComposerContext()
//   const { onChange } = useSharedOnChange()
//   const { historyState } = useSharedHistoryContext()
//   const editDepth = useEditDepth()
//   const imageRef = useRef<null | HTMLImageElement>(null)
//   const buttonRef = useRef<HTMLButtonElement | null>(null)
//   const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)
//   const [selection, setSelection] = useState<RangeSelection | NodeSelection | BaseSelection | null>(
//     null
//   )
//   const { config } = useConfig()
//   const {
//     serverURL,
//     routes: { api }
//   } = config

//   const editorState = editor.getEditorState()
//   const activeEditorRef = useRef<LexicalEditor | null>(null)
//   const node = editorState.read(() => $getNodeByKey(nodeKey) as InlineImageNode)

//   const {
//     toggleModal = () => {
//       console.error('Error: useModal() from Payload did not work correctly')
//     },
//     closeModal,
//     isModalOpen
//   } = useModal()

//   // NOTE: set the slug suffix to the document ID so that
//   // each image in the editor gets its own slug and modal
//   const inlineImageDrawerSlug = formatDrawerSlug({
//     slug: `rich-text-inline-image-update-lexical-${id}`,
//     depth: editDepth
//   })

//   const onDelete = useCallback(
//     (payload: KeyboardEvent) => {
//       if (isSelected && $isNodeSelection($getSelection())) {
//         const event: KeyboardEvent = payload
//         event.preventDefault()
//         const node = $getNodeByKey(nodeKey)
//         if ($isInlineImageNode(node)) {
//           node?.remove()
//         }
//         setSelected(false)
//       }
//       return false
//     },
//     [isSelected, nodeKey, setSelected]
//   )

//   const onEnter = useCallback(
//     (event: KeyboardEvent) => {
//       const latestSelection = $getSelection()
//       const buttonElem = buttonRef.current
//       if (
//         isSelected &&
//         $isNodeSelection(latestSelection) &&
//         latestSelection.getNodes().length === 1
//       ) {
//         if (showCaption) {
//           // Move focus into nested editor
//           $setSelection(null)
//           event.preventDefault()
//           caption.focus()
//           return true
//         } else if (buttonElem !== null && buttonElem !== document.activeElement) {
//           event.preventDefault()
//           buttonElem.focus()
//           return true
//         }
//       }
//       return false
//     },
//     [caption, isSelected, showCaption]
//   )

//   const onEscape = useCallback(
//     (event: KeyboardEvent) => {
//       if (activeEditorRef.current === caption || buttonRef.current === event.target) {
//         $setSelection(null)
//         editor.update(() => {
//           setSelected(true)
//           const parentRootElement = editor.getRootElement()
//           if (parentRootElement !== null) {
//             parentRootElement.focus()
//           }
//         })
//         return true
//       }
//       return false
//     },
//     [caption, editor, setSelected]
//   )

//   useEffect(() => {
//     let isMounted = true
//     const unregister = mergeRegister(
//       editor.registerUpdateListener(({ editorState }) => {
//         if (isMounted) {
//           setSelection(editorState.read(() => $getSelection()))
//         }
//       }),
//       editor.registerCommand(
//         SELECTION_CHANGE_COMMAND,
//         (_, activeEditor) => {
//           activeEditorRef.current = activeEditor
//           return false
//         },
//         COMMAND_PRIORITY_LOW
//       ),
//       editor.registerCommand<MouseEvent>(
//         CLICK_COMMAND,
//         (payload) => {
//           const event = payload
//           if (event.target === imageRef.current) {
//             if (event.shiftKey) {
//               setSelected(!isSelected)
//             } else {
//               clearSelection()
//               setSelected(true)
//             }
//             return true
//           }

//           return false
//         },
//         COMMAND_PRIORITY_LOW
//       ),
//       editor.registerCommand(
//         DRAGSTART_COMMAND,
//         (event) => {
//           if (event.target === imageRef.current) {
//             // TODO This is just a temporary workaround for FF to behave like other browsers.
//             // Ideally, this handles drag & drop too (and all browsers).
//             event.preventDefault()
//             return true
//           }
//           return false
//         },
//         COMMAND_PRIORITY_LOW
//       ),
//       editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
//       editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
//       editor.registerCommand(KEY_ENTER_COMMAND, onEnter, COMMAND_PRIORITY_LOW),
//       editor.registerCommand(KEY_ESCAPE_COMMAND, onEscape, COMMAND_PRIORITY_LOW)
//     )
//     return () => {
//       isMounted = false
//       unregister()
//     }
//   }, [clearSelection, editor, isSelected, nodeKey, onDelete, onEnter, onEscape, setSelected])

//   const draggable = isSelected && $isNodeSelection(selection)
//   const isFocused = isSelected

//   const handleToggleModal = (): void => {
//     if (id != null) {
//       toggleModal(inlineImageDrawerSlug)
//     }
//   }

//   const handleModalSubmit = async (data: InlineImageData): Promise<void> => {
//     closeModal(inlineImageDrawerSlug)
//     if (data?.id != null) {
//       try {
//         const url = `${serverURL}${api}/${collection}/${data.id}`
//         const response = await requests.get(url)
//         if (response.ok) {
//           const doc = await response.json()
//           const size = data?.position === 'default' ? 'medium' : 'small'
//           const imageSource = getPreferredSize(size, doc)
//           if (imageSource != null) {
//             const imagePayload: InlineImageAttributes = {
//               id: data.id,
//               collection,
//               src: imageSource.url,
//               altText: data?.altText,
//               position: data?.position,
//               showCaption: data?.showCaption
//             }

//             // We don't set width or height for SVG images
//             if (imageSource.width != null) {
//               imagePayload.width = imageSource.width
//             }

//             if (imageSource.height != null) {
//               imagePayload.height = imageSource.height
//             }

//             editor.update(() => {
//               node.update(imagePayload)
//             })
//           } else {
//             console.error('Error: unable to find image source from document in InlineImagePlugin.')
//           }
//         } else {
//           console.error('Error: Response not ok trying load existing image in InlineImagePlugin')
//         }
//       } catch (error) {
//         console.error('Error: trying load existing image in InlineImagePlugin', error)
//       }
//     }
//   }

//   const classNames = cx(
//     'InlineImageNode__container',
//     { focused: isFocused },
//     { draggable: $isNodeSelection(selection) }
//   )

//   // TODO: consider implementing a single-line custom editor with span and inline
//   // elements in order to keep caption html valid from within the parent paragraph
//   // https://github.com/facebook/lexical/discussions/3640
//   return (
//     <Suspense fallback={null}>
//       <>
//         <span draggable={draggable} className={classNames}>
//           <button
//             type="button"
//             className="image-edit-button"
//             ref={buttonRef}
//             onClick={handleToggleModal}
//           >
//             Edit
//           </button>
//           <LazyImage
//             id={id}
//             collection={collection}
//             src={src}
//             position={position}
//             altText={altText}
//             imageRef={imageRef}
//             width={width}
//             height={height}
//           />
//           {showCaption && (
//             <span className="InlineImageNode__caption_container">
//               <LexicalNestedComposer initialEditor={caption}>
//                 <OnChangePlugin
//                   ignoreSelectionChange={true}
//                   onChange={(nestedEditorState, nestedEditor, nestedTags) => {
//                     // Note: Shared 'onChange' context provider so that
//                     // caption change events can be registered with the parent
//                     // editor - in turn triggering the parent editor onChange
//                     // event, and therefore updating editorState and the field
//                     // value in Payload (Save Draft and Publish Changes will then
//                     // become 'enabled' from the caption as well as the parent
//                     // editor content.)

//                     // Parent editor state - not the LexicalNestedComposer in this case
//                     // although there are other ways that this could be used.
//                     const editorState = editor.getEditorState()
//                     if (onChange != null) onChange(editorState, editor, nestedTags)
//                   }}
//                 />
//                 <LinkPlugin />
//                 <FloatingLinkEditorPlugin />
//                 <FloatingTextFormatToolbarPlugin />
//                 <HistoryPlugin externalHistoryState={historyState} />
//                 <RichTextPlugin
//                   contentEditable={
//                     <ContentEditableInline className="InlineImageNode__contentEditable" />
//                   }
//                   placeholder={
//                     <PlaceholderInline className="InlineImageNode__placeholder">
//                       Enter a caption...
//                     </PlaceholderInline>
//                   }
//                   ErrorBoundary={LexicalErrorBoundary}
//                 />
//               </LexicalNestedComposer>
//             </span>
//           )}
//         </span>

//         {id != null && id.length > 0 && (
//           <InlineImageModal
//             isOpen={isModalOpen(inlineImageDrawerSlug)}
//             drawerSlug={inlineImageDrawerSlug}
//             data={{ id, altText, position, showCaption }}
//             onSubmit={(data: InlineImageData) => {
//               void handleModalSubmit(data)
//             }}
//             onClose={() => {
//               closeModal(inlineImageDrawerSlug)
//             }}
//           />
//         )}
//       </>
//     </Suspense>
//   )
// }
