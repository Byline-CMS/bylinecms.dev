export function GradientBackground() {
  return (
    <>
      <div className="fixed inset-0 -z-10" aria-hidden="true" />
      <div
        className="fixed left-1/3 top-0 -z-10 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-purple-400/30 dark:bg-purple-900/30 blur-[100px]"
        aria-hidden="true"
      />
      <div
        className="fixed right-0 top-1/4 -z-10 h-[600px] w-[600px] rounded-full bg-pink-400/20 dark:bg-pink-900/20 blur-[100px]"
        aria-hidden="true"
      />
      <div
        className="fixed bottom-0 left-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-amber-400/20 dark:bg-amber-900/20 blur-[100px]"
        aria-hidden="true"
      />
    </>
  )
}
