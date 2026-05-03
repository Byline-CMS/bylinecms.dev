import objectsToArray from './objectsToArray.js'

export default function objectsToString(object: any): string {
  return objectsToArray(object).join(' ')
}
