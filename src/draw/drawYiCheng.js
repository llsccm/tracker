import {
  buttonRes,
  formatCardNumbers,
  getResultContainer,
  normalizeCardNumbers,
  showTextResult
} from './drawHelpers'
import { n2N } from '../utils'

/**
 * 生成固定长度的点数组合及其点数和。
 * 【易城】需要比较手牌组合和牌堆组合，因此这里保留 selected 与 sum。
 * @param {number[]} numbers
 * @param {number} length
 * @returns {{selected: number[], sum: number}[]}
 */
function getYiChengGroups(numbers, length) {
  const groups = []

  function backtrack(start, selected, sum) {
    if (selected.length === length) {
      groups.push({ selected: selected.slice(), sum })
      return
    }

    for (let i = start; i < numbers.length; i += 1) {
      if (i > start && numbers[i] === numbers[i - 1]) continue // skip duplicates
      selected.push(numbers[i])
      backtrack(i + 1, selected, sum + numbers[i])
      selected.pop()
    }
  }

  backtrack(0, [], 0)
  return groups
}

function hasNumberOverlap(left, right) {
  const rightSet = new Set(right)
  return left.some((number) => rightSet.has(number))
}

/**
 * 刘辟【易城】小抄：寻找手牌可交换牌堆的高点数组合。
 * 优先展示等长组合；随后补充单张手牌可换的低点数牌堆候选。
 * @param {number[]} paiduiNumbers
 * @param {number[]} shoupaiNumbers
 */
export function drawYiCheng(paiduiNumbers, shoupaiNumbers) {
  const resDiv = getResultContainer()
  if (!resDiv) return

  if (!paiduiNumbers?.length || !shoupaiNumbers?.length) return

  const paidui = normalizeCardNumbers(paiduiNumbers)
  const shoupai = normalizeCardNumbers(shoupaiNumbers)
  const max = Math.min(paidui.length, shoupai.length)
  const fragment = document.createDocumentFragment()
  let rendered = 0

  for (let n = 2; n <= max; n++) {
    const paiduiGroups = getYiChengGroups(paidui, n)
    const handGroups = getYiChengGroups(shoupai, n)

    handGroups.forEach((handGroup) => {
      paiduiGroups.forEach((paiduiGroup) => {
        if (handGroup.sum <= paiduiGroup.sum) return
        if (hasNumberOverlap(handGroup.selected, paiduiGroup.selected)) return
        if (
          max >= 3 &&
          !handGroup.selected.some((number, index) => number < paiduiGroup.selected[index])
        ) {
          return
        }

        fragment.appendChild(
          buttonRes(
            `${formatCardNumbers(handGroup.selected)}→${formatCardNumbers(paiduiGroup.selected)}`,
            '点击复制',
            false
          )
        )
        rendered += 1
      })
    })
  }

  const shoupaiSet = Array.from(new Set(shoupai))
  const paiduiSet = Array.from(new Set(paidui))
  shoupaiSet.forEach((sp) => {
    const pd = paiduiSet.filter((n) => n < sp)
    if (!pd.length) return
    fragment.appendChild(
      buttonRes(n2N(sp) + '→' + pd.map((n) => n2N(n)).join('/'), '点击复制', false)
    )
    rendered += 1
  })

  if (!rendered) {
    showTextResult(resDiv, '【易城】无法交换！')
    return
  }

  resDiv.appendChild(fragment)
}
