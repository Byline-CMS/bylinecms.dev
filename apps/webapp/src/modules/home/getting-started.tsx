import { Button, Container, GithubIcon, Section } from '@infonomic/uikit/react'

export function GettingStarted() {
  return (
    <Section className="mb-8">
      <Container>
        <div className="max-w-[1224px] space-y-8 py-12 mb-8 container rounded-lg mx-auto px-4 sm:px-6 lg:px-8 text-center bg-gradient-to-r from-purple-600 to-blue-600 dark:from-purple-900 dark:to-purple-700">
          <div className="space-y-4">
            <h2 className="text-3xl sm:text-4xl font-bold text-white text-balance">
              We're Just Getting Started
            </h2>
            <p className="text-xl text-purple-100">
              Byline CMS is currently in active development. Join the{' '}
              <a
                className="underline"
                href="https://github.com/Byline-CMS/bylinecms.dev/discussions/"
                target="_blank"
                rel="noopener noreferrer"
              >
                discussion
              </a>{' '}
              to stay up to date on our progress and be the first to try new features.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              asChild
              size="md"
              variant="outlined"
              className="group not-dark text-lg px-5 py-2 text-white border-white hover:bg-white hover:text-purple-600 bg-transparent"
            >
              <a
                href="https://github.com/Byline-CMS/bylinecms.dev"
                target="_blank"
                rel="noopener noreferrer"
              >
                Follow Updates
                <GithubIcon
                  className="ml-2 w-5 h-5"
                  svgClassName="fill-white group-hover:fill-purple-600"
                />
              </a>
            </Button>
          </div>
        </div>
      </Container>
    </Section>
  )
}
