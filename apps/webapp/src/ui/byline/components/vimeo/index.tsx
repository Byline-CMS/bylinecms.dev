'use client'

import type React from 'react'

import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

export function VimeoSerializer({ node }: { node: SerializedLexicalNode }): React.JSX.Element {
  const videoID = node.videoID as string
  return (
    <iframe
      style={{
        aspectRatio: '16 / 9',
        width: '100%',
      }}
      src={`https://player.vimeo.com/video/${videoID}`}
      allow="autoplay fullscreen picture-in-picture"
      allowFullScreen={true}
      title="Vimeo Video"
    />
  )
}
