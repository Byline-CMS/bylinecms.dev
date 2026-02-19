// routes/_public/route.tsx  (pathless layout using _ prefix)
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_public')({
  component: PublicLayout,
})

function PublicLayout() {
  return (
    <>
      {/* <AppBar />  different from AdminAppBar */}
      <main>
        <Outlet />
      </main>
    </>
  )
}