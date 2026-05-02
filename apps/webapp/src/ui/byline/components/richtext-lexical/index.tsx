import { Serialize } from './serialize/index.tsx'
import type { Locale } from '@/i18n/i18n-config'

type RichTextIntrinsicProps = React.JSX.IntrinsicElements['div']
interface RichTextProps extends RichTextIntrinsicProps {
  id?: string
  lng: Locale
  className?: string
  wrapInDiv?: boolean
  nodes: any
}

export const LexicalRichText = ({
  nodes,
  lng,
  wrapInDiv = true,
}: RichTextProps): React.JSX.Element | null => {
  if (nodes == null) {
    return null
  }

  if (wrapInDiv) {
    return (
      <div className="editor-text">
        <Serialize lng={lng} nodes={nodes} />
      </div>
    )
  } else {
    return <Serialize lng={lng} nodes={nodes} />
  }
}
