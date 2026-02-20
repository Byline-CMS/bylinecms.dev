import { Container, Section } from '@infonomic/uikit/react'

import { WYSIWYGAnimation } from '@/modules/home/wysiwyg-animation'

export function EditorAnimation() {
  return (
    <Section className="py-8">
      <Container>
        <div className="max-w-4xl mx-auto">
          <WYSIWYGAnimation />
        </div>
      </Container>
    </Section>
  )
}
