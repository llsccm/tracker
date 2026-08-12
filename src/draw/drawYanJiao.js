import {
  countCardNumbers,
  formatNumberCounts,
  getCountedNumbersTotal,
  getResultContainer,
  normalizeCardNumbers,
  showTextResult
} from './drawHelpers'
import { toClipboard } from '../utils/clipboard'

function getYanJiaoRemain(counts, ...subsets) {
  const remain = counts.slice()

  for (let i = 0; i < remain.length; i += 1) {
    for (const subset of subsets) {
      remain[i] -= subset[i]
      if (remain[i] < 0) return null
    }
    if (i > 0 && remain[i] >= 2) return null
  }

  return remain
}

function createYanJiaoButton(left, right) {
  const button = document.createElement('button')
  const spanA = document.createElement('span')
  const spanB = document.createElement('span')

  button.className = 'calRes'
  button.title = '点击复制'
  spanA.innerText = formatNumberCounts(left).join('+')
  spanB.innerText = formatNumberCounts(right).join('+')

  button.appendChild(spanA)
  button.insertAdjacentHTML('beforeend', '<span>=</span>')
  button.appendChild(spanB)
  button.onclick = function () {
    toClipboard(button.innerText, true)
  }

  // if (allot) {
  //   button.title = '点击"="左侧或右侧的数字，将被点击一侧的数字分配给自己，另一侧的分配给张昌蒲'
  //   spanA.className = 'yanjiaospan'
  //   spanB.className = 'yanjiaospan'
  //   spanA.onclick = function (event) {
  //     event.stopPropagation()
  //     laya.yanJiao([left, right, remain], 2)
  //   }
  //   spanB.onclick = function (event) {
  //     event.stopPropagation()
  //     laya.yanJiao([left, right, remain], 0)
  //   }
  // }

  return button
}

/**
 * 张昌蒲【严教】小抄：寻找两组点数和相等的分牌方案。
 * counts[0] 保存总张数，后续下标保存对应点数张数，便于快速做多重集合扣减。
 * @param {number[]} array
 */
export function drawYanJiao(array) {
  const counts = countCardNumbers(normalizeCardNumbers(array))
  const half = Math.floor(getCountedNumbersTotal(counts) / 2)
  const subsetsBySum = new Map([[0, [Array(14).fill(0)]]])

  for (let number = 1; number <= 13; number += 1) {
    const count = counts[number]
    if (count === 0) continue

    for (const sum of Array.from(subsetsBySum.keys()).sort((a, b) => b - a)) {
      const subsets = subsetsBySum.get(sum)
      for (let n = 1; n <= count; n += 1) {
        const newSum = sum + number * n
        if (newSum > half) break
        if (!subsetsBySum.has(newSum)) subsetsBySum.set(newSum, [])

        const targetSubsets = subsetsBySum.get(newSum)
        for (const subset of subsets) {
          const nextSubset = subset.slice()
          nextSubset[0] += n
          nextSubset[number] += n
          targetSubsets.push(nextSubset)
        }
      }
    }
  }

  subsetsBySum.delete(0)

  const pairs = new Map()
  for (const sum of Array.from(subsetsBySum.keys()).sort((a, b) => b - a)) {
    const subsets = subsetsBySum.get(sum)
    for (let i = 0; i < subsets.length; i += 1) {
      for (let j = i; j < subsets.length; j += 1) {
        const remain = getYanJiaoRemain(counts, subsets[i], subsets[j])
        if (!remain) continue

        const [left, right] =
          subsets[i][0] <= subsets[j][0] ? [subsets[i], subsets[j]] : [subsets[j], subsets[i]]
        if (!pairs.has(remain[0])) pairs.set(remain[0], [])
        pairs.get(remain[0]).push([left, right, remain])
      }
    }
  }

  const resDiv = getResultContainer()
  if (!resDiv) return

  const fragment = document.createDocumentFragment()
  let rendered = 0

  for (const remainCount of Array.from(pairs.keys()).sort((a, b) => a - b)) {
    const pairsByRemain = pairs.get(remainCount).sort((a, b) => a[0][0] - b[0][0])
    for (const [left, right] of pairsByRemain) {
      fragment.appendChild(createYanJiaoButton(left, right))
      rendered += 1
      if (rendered >= 5) break
    }
    if (rendered >= 5) break
  }

  if (!rendered) {
    showTextResult(resDiv, '【严教】无解！')
    return
  }

  // if (allot) {
  //   resDiv.insertAdjacentHTML(
  //     'afterbegin',
  //     '界小抄：点下方数字可以自动分配牌<br>点击想要分配给自己的一组数字即可'
  //   )
  // }

  resDiv.appendChild(fragment)
}
