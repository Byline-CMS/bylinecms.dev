export default function objectsToArray(object: any): any[] {
  const result: any[] = []

  Object.values(object).forEach((value) => {
    if (typeof value === 'string') {
      result.push(value)
    } else if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      result.push(...objectsToArray(value))
    }
  })

  return result
}
