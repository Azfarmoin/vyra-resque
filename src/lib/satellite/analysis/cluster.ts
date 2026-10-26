// Connected-component filtering (4-neighbourhood). Isolated single pixels are the typical signature of
// speckle and mis-registration, so classes whose cluster is smaller than the minimum mapping unit are dropped.
export function removeSmallClusters(classes: Uint8Array, width: number, height: number, codes: readonly number[], minPixels: number, fallback: (i: number) => number): number {
  if (minPixels <= 1) return 0
  const want = new Set(codes), seen = new Uint8Array(classes.length), stack: number[] = []
  let removed = 0
  for (let start = 0; start < classes.length; start++) {
    const code = classes[start]
    if (seen[start] || !want.has(code)) continue
    const members: number[] = []
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      members.push(i)
      const x = i % width, y = (i - x) / width
      if (x > 0 && !seen[i - 1] && classes[i - 1] === code) { seen[i - 1] = 1; stack.push(i - 1) }
      if (x < width - 1 && !seen[i + 1] && classes[i + 1] === code) { seen[i + 1] = 1; stack.push(i + 1) }
      if (y > 0 && !seen[i - width] && classes[i - width] === code) { seen[i - width] = 1; stack.push(i - width) }
      if (y < height - 1 && !seen[i + width] && classes[i + width] === code) { seen[i + width] = 1; stack.push(i + width) }
    }
    if (members.length < minPixels) {
      for (const i of members) classes[i] = fallback(i)
      removed += members.length
    }
  }
  return removed
}
