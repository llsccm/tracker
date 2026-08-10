import { n2N } from '../utils'
import { toClipboard } from '../utils/clipboard'

export function clearElement(element) {
  while (element?.firstChild) element.removeChild(element.firstChild)
}

export function buttonRes(
  text,
  title = '点击复制',
  encode = true,
  disable = false,
  _callback = null
) {
  const button = document.createElement('button')
  button.className = 'calRes'
  button.title = title
  button.disabled = disable
  button.innerText = text
  button.onclick = () => {
    toClipboard(text, encode)
    button.innerText = '复制成功'
    setTimeout(() => {
      button.textContent = text
    }, 500)
  }
  // callback是由游戏点击设置或者查看人物的时候生成的 调用的callback不一定存在
  // copyCallBack ? copyCallBack(true) : false
  return button
}

/** 会先清空 #result */
export function getResultContainer() {
  const resDiv = document.getElementById('result')
  if (resDiv) clearElement(resDiv)
  return resDiv
}

export function showTextResult(container, text) {
  container.innerHTML = `<span class="textRes">${text}</span>`
}

/**
 * 将卡牌点数规整为 1-13 的有序数组。
 * 技能小抄都以点数集合为输入，花色/牌名展示在调用方处理。
 * @param {unknown[]} array
 * @returns {number[]}
 */
export function normalizeCardNumbers(array) {
  return (array || [])
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= 13)
    .sort((a, b) => a - b)
}

export function formatCardNumbers(numbers, useAce = true) {
  return numbers.map((number) => n2N(number, useAce)).join('+')
}

export function countCardNumbers(numbers) {
  const counts = Array(14).fill(0)

  numbers.forEach((number) => {
    counts[0] += 1
    counts[number] += 1
  })

  return counts
}

export function getCountedNumbersTotal(counts) {
  return counts.reduce((sum, count, number) => sum + count * number, 0)
}

export function formatNumberCounts(counts) {
  return counts.flatMap((count, number) =>
    number > 0 ? Array(count).fill(n2N(number, false)) : []
  )
}
