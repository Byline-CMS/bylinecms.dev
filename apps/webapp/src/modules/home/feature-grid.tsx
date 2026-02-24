import { Container, Section } from '@infonomic/uikit/react'

export function FeatureGrid() {
  return (
    <Section className="pt-12 pb-12 sm:pb-22">
      <Container>
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-balance">
            Built for Modern Content Platforms
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto text-balance">
            Everything you need to build content-driven applications with speed and flexibility.
          </p>
        </div>

        {/* <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <Card className="pb-4">
            <Card.Header>
              <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                <Database className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <Card.Title className="dark:text-white text-2xl">Headless Architecture</Card.Title>
              <Card.Description className="dark:text-gray-300">
                API-first design that works with any frontend framework or technology stack.
              </Card.Description>
            </Card.Header>
          </Card>

          <Card className="pb-4">
            <Card.Header>
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                <Zap className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <Card.Title className="dark:text-white  text-2xl">Lightning Fast</Card.Title>
              <Card.Description className="dark:text-gray-300">
                Optimized for performance with edge caching and blazing fast content delivery.
              </Card.Description>
            </Card.Header>
          </Card>

          <Card className="pb-4">
            <Card.Header>
              <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <Card.Title className="dark:text-white  text-2xl">Community Driven</Card.Title>
              <Card.Description className="dark:text-gray-300">
                Open source project built with community feedback and contributions at its core.
              </Card.Description>
            </Card.Header>
          </Card>
        </div> */}
      </Container>
    </Section>
  )
}
