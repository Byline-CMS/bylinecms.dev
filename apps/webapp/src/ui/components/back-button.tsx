import { useRouter } from '@tanstack/react-router'

import { Button, ReturnIcon } from '@byline/ui/react'

export function BackButton() {
  const router = useRouter()

  return (
    <Button
      className="text-white dark:white"
      onClick={() => {
        router.history.back()
      }}
    >
      Back <ReturnIcon width="18px" height="18px" />
    </Button>
  )
}
