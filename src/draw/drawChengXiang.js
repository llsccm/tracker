import {
  buttonRes,
  formatCardNumbers,
  getResultContainer,
  normalizeCardNumbers
} from './drawHelpers'

function isStrictMultisetSubset(subset, superSet) {
  if (subset.length >= superSet.length) return false

  const counts = new Map()
  superSet.forEach((number) => counts.set(number, (counts.get(number) || 0) + 1))

  return subset.every((number) => {
    const count = counts.get(number) || 0
    if (count <= 0) return false
    counts.set(number, count - 1)
    return true
  })
}

/**
 * 曹冲【称象】小抄：枚举点数和不超过 13 的子集。
 * K 模式下会优先标记刚好等于 13 的最长组合。
 * @param {number[]} array
 * @param {boolean} K
 */
export function drawChengXiang(array, K) {
  const arr = normalizeCardNumbers(array)
  if (!arr.length) return

  const results = []

  function backtrack(temp, start, sum) {
    if (sum > 13) return
    if (temp.length > 0) {
      const numbers = temp.slice()
      const exact = K && sum === 13 ? temp.length : 0
      results.push({ numbers, exact })
    }

    for (let i = start; i < arr.length; i++) {
      if (i > start && arr[i] === arr[i - 1]) continue // skip duplicates
      if (sum + arr[i] > 13) break
      temp.push(arr[i])
      backtrack(temp, i + 1, sum + arr[i])
      temp.pop()
    }
  }

  backtrack([], 0, 0)

  const resDiv = getResultContainer()
  if (!resDiv) return

  const fragment = document.createDocumentFragment()
  const visibleResults = results
    .filter(
      (subset, _, self) =>
        !self.some((superSet) => isStrictMultisetSubset(subset.numbers, superSet.numbers))
    )
    .sort((a, b) => (b.exact || 0) - (a.exact || 0) || b.numbers.length - a.numbers.length)

  for (const result of visibleResults) {
    const button = buttonRes(formatCardNumbers(result.numbers, false))
    if (K && result.exact) button.classList.add('textRes')
    fragment.appendChild(button)
  }

  resDiv.appendChild(fragment)
}
