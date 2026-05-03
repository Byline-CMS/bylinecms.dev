const isTouchDevice = (): boolean => {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      // @ts-expect-error: error
      navigator.msMaxTouchPoints > 0)
  )
}

export default isTouchDevice
