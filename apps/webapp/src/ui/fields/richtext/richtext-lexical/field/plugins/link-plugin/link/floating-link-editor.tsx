// 'use client'

// import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
// import { $findMatchingParent, mergeRegister } from '@lexical/utils'
// import { formatDrawerSlug, useConfig, useEditDepth, useModal } from '@payloadcms/ui'
// import type { LexicalEditor } from 'lexical'
// import {
//   $getSelection,
//   $isLineBreakNode,
//   $isRangeSelection,
//   COMMAND_PRIORITY_CRITICAL,
//   COMMAND_PRIORITY_HIGH,
//   COMMAND_PRIORITY_LOW,
//   KEY_ESCAPE_COMMAND,
//   SELECTION_CHANGE_COMMAND,
// } from 'lexical'
// import type { ClientConfig } from 'payload'
// import type { Dispatch } from 'react'
// /**
//  * Portions Copyright (c) Meta Platforms, Inc. and affiliates.
//  *
//  * This source code is licensed under the MIT license found in the
//  * LICENSE file in the root directory of this source tree.
//  *
//  */
// import * as React from 'react'
// import { useCallback, useEffect, useRef, useState } from 'react'
// import { createPortal } from 'react-dom'
// import { useEditorConfig } from '../../../config/editor-config-context'
// import type { LinkAttributes } from '../../../nodes/link-nodes'
// import { $isAutoLinkNode, $isLinkNode, TOGGLE_LINK_COMMAND } from '../../../nodes/link-nodes'
// import { getSelectedNode } from '../../../utils/getSelectedNode'
// import { setFloatingElemPositionForLinkEditor } from '../../../utils/setFloatingElemPositionForLinkEditor'
// import { sanitizeUrl } from '../../../utils/url'
// import { LinkDrawer } from './link-drawer'
// import type { LinkData } from './types'

// import './floating-link-editor.css'

// function createPreviewLink(config: ClientConfig, url: string | undefined): string | undefined {
//   if (url?.startsWith('/') ?? false) {
//     return `${config.serverURL}${url}`
//   } else {
//     return url
//   }
// }

// interface LinkEditorState {
//   label: string | null
//   url: string
// }

// interface FloatingLinkEditorProps {
//   editor: LexicalEditor
//   isLink: boolean
//   setIsLink: Dispatch<boolean>
//   anchorElem: HTMLElement
// }

// function FloatingLinkEditor({
//   editor,
//   isLink,
//   setIsLink,
//   anchorElem,
// }: FloatingLinkEditorProps): React.JSX.Element {
//   const editorRef = useRef<HTMLDivElement | null>(null)

//   const [linkEditorState, setLinkEditorState] = useState<LinkEditorState>({ label: null, url: '' })
//   const [linkDrawerData, setLinkDrawerData] = useState<LinkData | undefined>(undefined)

//   const { uuid } = useEditorConfig()
//   const { config } = useConfig()
//   const { toggleModal, isModalOpen, closeModal } = useModal()
//   const editDepth = useEditDepth()
//   const drawerSlug = formatDrawerSlug({
//     slug: `rich-text-link-lexical-${uuid}`,
//     depth: editDepth,
//   })

//   const $updateLinkEditor = useCallback(() => {
//     const selection = $getSelection()
//     if ($isRangeSelection(selection)) {
//       const node = getSelectedNode(selection)
//       const linkParent = $findMatchingParent(node, $isLinkNode)

//       // Initial state:
//       let data: LinkData = {
//         text: '',
//         fields: {
//           url: '',
//           linkType: undefined,
//           newTab: undefined,
//           doc: undefined,
//         },
//       }

//       let linkNode
//       if (linkParent != null) {
//         linkNode = linkParent
//       } else if ($isLinkNode(node)) {
//         linkNode = node
//       } else {
//         linkNode = null
//       }

//       if (linkNode != null) {
//         // Prepare LinkDrawer data
//         data = {
//           text: linkNode.getTextContent(),
//           fields: linkNode.getAttributes(),
//         }

//         if (data.fields?.linkType === 'custom') {
//           // custom
//           setLinkEditorState({
//             label: null,
//             url: createPreviewLink(config, data.fields?.url) ?? '',
//           })
//         } else {
//           // internal
//           setLinkEditorState({
//             label: `relation to ${data.fields?.doc?.relationTo}: ${data.fields?.doc?.value}`,
//             url: `${config.serverURL}${config.routes.admin}/collections/${
//               data.fields?.doc?.relationTo
//             }/${data.fields?.doc?.value}`,
//           })
//         }
//       } else {
//         setLinkEditorState({
//           label: null,
//           url: '',
//         })
//       }

//       setLinkDrawerData(data)
//     }

//     const editorElem = editorRef.current
//     const nativeSelection = window.getSelection()
//     const { activeElement } = document

//     if (editorElem === null) {
//       return
//     }

//     const rootElement = editor.getRootElement()

//     if (
//       selection !== null &&
//       nativeSelection !== null &&
//       rootElement !== null &&
//       rootElement.contains(nativeSelection.anchorNode) &&
//       editor.isEditable()
//     ) {
//       const domRect: DOMRect | undefined =
//         nativeSelection.focusNode?.parentElement?.getBoundingClientRect()
//       if (domRect != null) {
//         domRect.y += 40
//         setFloatingElemPositionForLinkEditor(domRect, editorElem, anchorElem)
//       }
//       // setLastSelection(selection)
//     } else if (activeElement == null || activeElement.className !== 'link-input') {
//       if (rootElement !== null) {
//         setFloatingElemPositionForLinkEditor(null, editorElem, anchorElem)
//       }
//       // setLastSelection(null)
//       setLinkEditorState({ label: null, url: '' })
//     }

//     return true
//   }, [anchorElem, editor, config])

//   useEffect(() => {
//     const scrollerElem = anchorElem.parentElement

//     const update = (): void => {
//       editor.getEditorState().read(() => {
//         $updateLinkEditor()
//       })
//     }

//     window.addEventListener('resize', update)

//     if (scrollerElem != null) {
//       scrollerElem.addEventListener('scroll', update)
//     }

//     return () => {
//       window.removeEventListener('resize', update)

//       if (scrollerElem != null) {
//         scrollerElem.removeEventListener('scroll', update)
//       }
//     }
//   }, [anchorElem.parentElement, editor, $updateLinkEditor])

//   useEffect(() => {
//     return mergeRegister(
//       editor.registerUpdateListener(({ editorState }) => {
//         editorState.read(() => {
//           $updateLinkEditor()
//         })
//       }),

//       editor.registerCommand(
//         SELECTION_CHANGE_COMMAND,
//         () => {
//           void $updateLinkEditor()
//           return true
//         },
//         COMMAND_PRIORITY_LOW
//       ),
//       editor.registerCommand(
//         KEY_ESCAPE_COMMAND,
//         () => {
//           if (isLink) {
//             setIsLink(false)
//             return true
//           }
//           return false
//         },
//         COMMAND_PRIORITY_HIGH
//       )
//     )
//   }, [editor, $updateLinkEditor, setIsLink, isLink])

//   useEffect(() => {
//     editor.getEditorState().read(() => {
//       $updateLinkEditor()
//     })
//   }, [editor, $updateLinkEditor])

//   /**
//    * handleModalSubmit
//    * @param data
//    */
//   const handleModalSubmit = (data: LinkData): void => {
//     closeModal(drawerSlug)
//     const newNode: LinkAttributes & { text: string | null } = {
//       newTab: data.fields?.newTab,
//       url: data?.fields?.linkType === 'custom' ? data?.fields?.url : undefined,
//       linkType: data?.fields?.linkType,
//       doc: data?.fields?.linkType === 'internal' ? data?.fields?.doc : undefined,
//       text: data?.text,
//     }

//     editor.dispatchCommand(TOGGLE_LINK_COMMAND, newNode)
//   }

//   return (
//     <div ref={editorRef} className="link-editor">
//       {isLink === true && (
//         <>
//           <div className="link-input">
//             <a href={sanitizeUrl(linkEditorState.url)} target="_blank" rel="noopener noreferrer">
//               {linkEditorState.label != null && linkEditorState.label.length > 0
//                 ? linkEditorState.label
//                 : linkEditorState.url}
//             </a>
//             <div
//               aria-label="Edit link"
//               className="link-edit"
//               role="button"
//               tabIndex={0}
//               // We don't want to navigate away from the editor when clicking the link
//               onMouseDown={(event) => {
//                 event.preventDefault()
//               }}
//               onClick={() => {
//                 toggleModal(drawerSlug)
//               }}
//             />
//             <div
//               aria-label="Remove link"
//               className="link-trash"
//               role="button"
//               tabIndex={0}
//               onMouseDown={(event) => {
//                 event.preventDefault()
//               }}
//               onClick={() => {
//                 editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
//               }}
//             />
//           </div>
//           <LinkDrawer
//             isOpen={isModalOpen(drawerSlug)}
//             drawerSlug={drawerSlug}
//             data={linkDrawerData}
//             onSubmit={handleModalSubmit}
//             onClose={() => {
//               closeModal(drawerSlug)
//             }}
//           />
//         </>
//       )}
//     </div>
//   )
// }

// function useFloatingLinkEditor(
//   editor: LexicalEditor,
//   anchorElem: HTMLElement
// ): React.JSX.Element | null {
//   const [activeEditor, setActiveEditor] = useState(editor)
//   const [isLink, setIsLink] = useState(false)

//   useEffect(() => {
//     const $determineIsLink = () => {
//       const selection = $getSelection()
//       if ($isRangeSelection(selection)) {
//         const focusNode = getSelectedNode(selection)
//         const focusLinkNode = $findMatchingParent(focusNode, $isLinkNode)
//         const focusAutoLinkNode = $findMatchingParent(focusNode, $isAutoLinkNode)
//         if (focusLinkNode == null && focusAutoLinkNode == null) {
//           setIsLink(false)
//           return
//         }
//         // Test that we have a valid link node
//         const invalidLinkNode = selection
//           .getNodes()
//           .filter((node) => !$isLineBreakNode(node))
//           .find((node) => {
//             const linkNode = $findMatchingParent(node, $isLinkNode)
//             const autoLinkNode = $findMatchingParent(node, $isAutoLinkNode)
//             return (
//               (focusLinkNode && !focusLinkNode.is(linkNode)) ||
//               (linkNode && !linkNode.is(focusLinkNode)) ||
//               (focusAutoLinkNode && !focusAutoLinkNode.is(autoLinkNode)) ||
//               (autoLinkNode && !autoLinkNode.is(focusAutoLinkNode))
//             )
//           })
//         if (invalidLinkNode == null) {
//           setIsLink(true)
//         } else {
//           setIsLink(false)
//         }
//       }
//     }

//     return mergeRegister(
//       editor.registerUpdateListener(({ editorState }) => {
//         editorState.read(() => {
//           $determineIsLink()
//         })
//       }),

//       editor.registerCommand(
//         SELECTION_CHANGE_COMMAND,
//         (_payload, newEditor) => {
//           $determineIsLink()
//           setActiveEditor(newEditor)
//           return false
//         },
//         COMMAND_PRIORITY_CRITICAL
//       )
//     )
//   }, [editor])

//   return createPortal(
//     <FloatingLinkEditor
//       editor={activeEditor}
//       anchorElem={anchorElem}
//       isLink={isLink}
//       setIsLink={setIsLink}
//     />,
//     anchorElem
//   )
// }

// export function FloatingLinkEditorPlugin({
//   anchorElem = document.body,
// }: {
//   anchorElem?: HTMLElement
// }): React.JSX.Element | null {
//   const [editor] = useLexicalComposerContext()
//   return useFloatingLinkEditor(editor, anchorElem)
// }
