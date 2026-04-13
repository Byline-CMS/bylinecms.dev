import { createFileRoute, Outlet } from '@tanstack/react-router'

import { AdminAppBar } from '@/ui/components/admin-app-bar'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'

export const Route = createFileRoute('/{-$lng}/(byline)/admin')({
  component: AdminLayoutComponent,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function AdminLayoutComponent() {
  return (
    <>
      <AdminAppBar />
      <main className="flex flex-col flex-1 pt-[55px] w-full max-w-full">
        <Outlet />
      </main>
    </>
  )
}
