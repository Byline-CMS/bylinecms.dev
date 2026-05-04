'use client'

import type React from 'react'

import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

export function YouTubeSerializer({ node }: { node: SerializedLexicalNode }): React.JSX.Element {
  const videoID = node.videoID as string
  return (
    <iframe
      style={{
        aspectRatio: '16 / 9',
        width: '100%',
      }}
      src={`https://www.youtube-nocookie.com/embed/${videoID}`}
      frameBorder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen={true}
      title="YouTube Video"
    />
  )
}
