function findMatch(data: any, find: any, defaultValue: any): any {
  const founded = data.findIndex((el: any) => el === find)

  return founded >= 0 ? find : defaultValue
}

export default findMatch
