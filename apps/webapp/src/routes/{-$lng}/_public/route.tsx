// routes/_public/route.tsx  (pathless layout using _ prefix)

import { createFileRoute, Outlet } from '@tanstack/react-router'

import { GradientBackground } from '@/modules/home/gradient-background'
import { AppBar } from '@/ui/components/app-bar'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'

export const Route = createFileRoute('/{-$lng}/_public')({
  component: PublicLayout,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function PublicLayout() {
  return (
    <>
      <GradientBackground />
      <AppBar lng="en" />
      <main id="main-content" className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </>
  )
}
