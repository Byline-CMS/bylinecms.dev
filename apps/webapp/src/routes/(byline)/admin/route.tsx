import { createFileRoute, Outlet } from '@tanstack/react-router'

import { AdminAppBar } from '@/ui/components/admin-app-bar'

export const Route = createFileRoute('/(byline)/admin')({
  component: AdminLayoutComponent,
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
