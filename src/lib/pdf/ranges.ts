/**
 * Parses page ranges like "1-3, 5, 8-" (1-based, inclusive) into groups of
 * 0-based page indexes. Each comma-separated part becomes its own group, which
 * is what "split into files" needs. Throws a readable error on invalid input.
 */
export function parseRanges(input: string, pageCount: number): number[][] {
  const parts = input
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) throw new Error('Enter at least one page range, e.g. 1-3, 5')
  return parts.map((part) => {
    const m = /^(\d*)\s*(?:(-)\s*(\d*))?$/.exec(part)
    if (!m || (!m[1] && !m[3])) throw new Error(`“${part}” is not a valid range`)
    const start = m[1] ? Number(m[1]) : 1
    const end = m[2] ? (m[3] ? Number(m[3]) : pageCount) : start
    if (start < 1 || end < 1 || start > pageCount || end > pageCount)
      throw new Error(`“${part}” is outside 1–${pageCount}`)
    if (start > end) throw new Error(`“${part}”: start is after end`)
    return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i)
  })
}

/** "Every N pages" split. */
export function chunkRanges(pageCount: number, size: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i < pageCount; i += size) out.push(Array.from({ length: Math.min(size, pageCount - i) }, (_, k) => i + k))
  return out
}

export function describeRange(indexes: number[]) {
  if (!indexes.length) return ''
  const a = indexes[0] + 1
  const b = indexes[indexes.length - 1] + 1
  return a === b ? `${a}` : `${a}-${b}`
}
