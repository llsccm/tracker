import {
  buttonRes,
  formatCardNumbers,
  getResultContainer,
  normalizeCardNumbers,
  showTextResult
} from './drawHelpers'

/**
 * 糜竺【资援】小抄：枚举点数和为 13 的组合。
 * 结果按牌数从多到少展示，最多保留 15 个，避免聊天/结果区被组合爆炸撑满。
 * @param {number[]} array
 */
export function drawMiZhu(array) {
  const arr = normalizeCardNumbers(array)
  const results = []

  function backtrack(temp, start, sum) {
    if (sum === 13) {
      results.push(temp.slice())
      return
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
  const sortedResults = results.sort((a, b) => b.length - a.length)

  for (let i = 0; i < sortedResults.length && i < 15; i += 1) {
    fragment.appendChild(buttonRes(formatCardNumbers(sortedResults[i], false)))
  }

  if (!fragment.childNodes.length) {
    showTextResult(resDiv, '【资援】无解！')
    return
  }

  resDiv.appendChild(fragment)
}
