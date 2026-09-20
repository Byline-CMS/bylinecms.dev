import { describe, expect, it } from 'vitest'

import { parseVideoEmbedId, videoEmbedSrc } from './video-embed-url'

describe('parseVideoEmbedId', () => {
  it('reads a YouTube id from watch, short, embed and shorts URLs', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=HOWSp3QNkRg',
      'https://www.youtube.com/watch?list=PL123&v=HOWSp3QNkRg',
      'https://youtu.be/HOWSp3QNkRg',
      'https://www.youtube.com/embed/HOWSp3QNkRg',
      'https://www.youtube.com/shorts/HOWSp3QNkRg',
    ]) {
      expect(parseVideoEmbedId('youtube', url)).toBe('HOWSp3QNkRg')
    }
  })

  it('reads a Vimeo id from page and player URLs', () => {
    expect(parseVideoEmbedId('vimeo', 'https://vimeo.com/76979871')).toBe('76979871')
    expect(parseVideoEmbedId('vimeo', 'https://vimeo.com/video/76979871')).toBe('76979871')
  })

  it('returns undefined when the URL does not match the selected provider', () => {
    expect(parseVideoEmbedId('youtube', 'https://vimeo.com/76979871')).toBeUndefined()
    expect(parseVideoEmbedId('vimeo', 'https://youtu.be/HOWSp3QNkRg')).toBeUndefined()
  })

  it('returns undefined for empty, blank or absent input', () => {
    expect(parseVideoEmbedId('youtube', '')).toBeUndefined()
    expect(parseVideoEmbedId('youtube', '   ')).toBeUndefined()
    expect(parseVideoEmbedId('youtube', null)).toBeUndefined()
    expect(parseVideoEmbedId(undefined, 'https://www.youtube.com/watch?v=HOWSp3QNkRg')).toBe(
      'HOWSp3QNkRg'
    )
  })

  it('builds cookie-free player URLs', () => {
    expect(videoEmbedSrc('youtube', 'HOWSp3QNkRg')).toBe(
      'https://www.youtube-nocookie.com/embed/HOWSp3QNkRg'
    )
    expect(videoEmbedSrc('vimeo', '76979871')).toBe('https://player.vimeo.com/video/76979871')
  })
})
