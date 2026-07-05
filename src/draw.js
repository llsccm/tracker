import { CardConfig } from './config'
import { UI } from './tracker'
import { laya } from './runtime/gameAdapter'
import { getCardFaceHtml, n2N } from './utils'
import { toClipboard } from './utils/clipboard'

export { toClipboard } from './utils/clipboard'

/**
 * 初始化聊天面板里的表情与快捷语句。
 * 这里直接写宿主聊天 DOM，点击动作只复制文本，不主动发送消息。
 */
export function drawChatFace() {
  const chatBody = document.getElementsByClassName('chat-body')[0]
  if (!chatBody) return

  const fragment = document.createDocumentFragment()

  for (let i = 11; i <= 60; i++) {
    const link = `https://web.sanguosha.com/220/h5_2/res/runtime/pc/Face/${i}.png`
    const img = document.createElement('img')
    img.src = link
    img.classList.add('face')
    img.onmousedown = () => toClipboard(`#${i}`, false)
    fragment.appendChild(img)
  }

  const chatMessages = [
    '昏君，昏君啊',
    '主公，别开枪，自己人',
    '能不能快一点儿呀，兵贵神速啊',
    '小内再不跳，后面还怎么玩儿啊',
    '小内啊，您老悠着点儿',
    '不好意思，刚才卡了',
    '你可以打的再烂一点儿吗',
    '哥们儿，给力点儿行吗',
    '你们怎么忍心就这么让我酱油了',
    '我，我惹你们了吗',
    '姑娘，你真是条汉子',
    '三十六计，走为上，容我去去便回',
    '人心散了，队伍不好带啊',
    '风吹鸡蛋壳，牌去人安乐',
    '哥，交个朋友吧',
    '妹子，交个朋友吧',
    '我从未见过如此厚颜无耻之人',
    '你随便杀，闪不了算我输',
    '这波不亏',
    '请收下我的膝盖',
    '你咋不上天呢',
    '放开我的队友，冲我来',
    '见证奇迹的时刻到了'
  ]

  chatMessages.forEach((message) => {
    const span = document.createElement('span')
    span.classList.add('calRes')
    span.textContent = message

    span.onmousedown = () => toClipboard(`${message}`, false)
    fragment.appendChild(span)
  })

  chatBody.appendChild(fragment)
}

/**
 * 渲染最近一次使用/记录的手牌按钮。
 * 输入只使用物理牌 ID，展示元数据统一从 CardConfig 单例读取。
 * @param {number[]|string[]} shoupai
 */
export function drawCard(shoupai) {
  const toBeAdd = document.getElementById('lastUseCard')
  if (!toBeAdd) return

  const fragment = document.createDocumentFragment()

  for (const s of shoupai) {
    if (s == '0') continue
    const button = document.createElement('button')
    const card = CardConfig.GetInstance().getCard(s)
    button.classList.add('shoupai')
    button.classList.toggle('red-card', card.color <= 2)
    button.innerHTML = getCardFaceHtml(card)
    fragment.appendChild(button)
  }

  clearElement(toBeAdd)
  toBeAdd.appendChild(fragment)
}

function checkOverflow(orderBody) {
  if (orderBody && orderBody instanceof HTMLElement) {
    // 确保元素可见后再检查高度
    requestAnimationFrame(() => {
      if (orderBody.scrollHeight > 40) {
        orderBody.classList.add('show-ellipsis')
      } else {
        orderBody.classList.remove('show-ellipsis')
      }
    })
  }
}

function clearElement(element) {
  while (element?.firstChild) element.removeChild(element.firstChild)
}

let deckEdgeButtons = []
let deckEdgeSignature = ''
let deckEdgeRenderedSignature = ''

function cloneCardButton(button) {
  const clone = button.cloneNode(true)
  clone.removeAttribute('id')
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
  return clone
}

function clearDirectCards(element) {
  element?.querySelectorAll(':scope>.shoupai').forEach((e) => e.remove())
}

/**
 * 渲染牌堆顶/底边缘镜像。
 * 该区域挂在回合信息附近，依赖座位布局完成后再计算可用宽度。
 */
function renderDeckEdgeCards() {
  const deck = document.getElementById('deckEdgeUI')
  if (!deck) return

  if (!UI.seatUIs.length || !deckEdgeButtons.length) {
    if (deck.firstChild) clearElement(deck)
    deckEdgeRenderedSignature = ''
    deck.style.display = 'none'
    return
  }

  const existing = document.getElementById('deckBottomEdge')
  if (existing && deckEdgeRenderedSignature === deckEdgeSignature) {
    checkOverflow(existing)
    deck.style.display = 'block'
    return
  }

  clearElement(deck)
  const edge = document.createElement('div')
  const fragment = document.createDocumentFragment()
  edge.id = 'deckBottomEdge'
  edge.className = 'sorder-body paiduiCards'

  for (let i = deckEdgeButtons.length - 1; i >= 0; i -= 1) {
    fragment.appendChild(cloneCardButton(deckEdgeButtons[i]))
  }

  edge.appendChild(fragment)
  deck.appendChild(edge)
  deckEdgeRenderedSignature = deckEdgeSignature
  checkOverflow(edge)
  deck.style.display = 'block'
}

/**
 * 清理所有区域镜像。
 * 对局销毁或视图重挂载时调用，确保旧 DOM 不污染下一局座位。
 */
export function clearZoneMirrors() {
  deckEdgeButtons = []
  deckEdgeSignature = ''
  deckEdgeRenderedSignature = ''
  document.querySelectorAll('#seatUI .sorder-body').forEach(clearDirectCards)
  document.querySelectorAll('#seatUI .markedCard').forEach((element) => element.remove())
  // drawDeckEdgeUI()
}

/**
 * 根据回合信息条与座位矩形计算牌堆边缘镜像位置。
 * 宿主坐标可能是缩放前或缩放后的值，因此这里同时兼容 UI.gameRoundRect 与 Laya 原始对象。
 */
export function drawDeckEdgeUI() {
  const deck = document.getElementById('deckEdgeUI')
  if (!deck) return

  if (!UI.seatUIs.length) {
    clearElement(deck)
    deck.style.display = 'none'
    return
  }

  const scale = UI.scale || 1
  const dpr = window.devicePixelRatio || 1
  const baseWidth = UI.gameRoundRect
    ? (((UI.unscaledWidth + UI.paddingRight) * scale) >> 0) / dpr
    : (UI.unscaledWidth + UI.paddingRight) * scale
  const roundWidth = 127 * scale
  const round = UI.gameRoundRect || laya.gamescene?.gameRoundInfo
  const roundX = UI.gameRoundRect
    ? UI.gameRoundRect.x
    : round
      ? ((round.x * scale) >> 0) / dpr
      : ((UI.width - 220 * scale - roundWidth) >> 0) / dpr
  const roundY = UI.gameRoundRect ? UI.gameRoundRect.y : (25 * scale) / dpr
  const nearest = getNearestSeatRectBeforeRound(roundX, roundY)
  const width = nearest ? Math.min(baseWidth, Math.max(48, roundX - nearest.right - 8)) : baseWidth
  const x = roundX - width - 4

  deck.style.width = width + 'px'
  deck.style.left = x + 'px'
  deck.style.top = roundY + 'px'

  renderDeckEdgeCards()
}

/**
 * 找到回合信息条左侧最近的座位矩形，用来限制牌堆镜像最大宽度。
 * @param {number} roundX
 * @param {number} roundY
 * @returns {object|null}
 */
function getNearestSeatRectBeforeRound(roundX, roundY) {
  let nearest = null

  for (const seat of UI.nativeSeatRects || []) {
    if (seat.right > roundX || seat.bottom <= roundY) continue
    if (!nearest || seat.right > nearest.right) nearest = seat
  }

  return nearest
}

/**
 * 通用防抖工具，用于高频 resize 后合并 DOM 测量和重绘。
 * @param {Function} func
 * @param {number} wait
 * @returns {Function}
 */
export function debounce(func, wait) {
  let timeout

  function debounced(...args) {
    clearTimeout(timeout)
    timeout = setTimeout(() => func.apply(this, args), wait)
  }

  // 添加取消方法
  debounced.cancel = function () {
    clearTimeout(timeout)
    timeout = null
  }

  return debounced
}

// resize 先防抖再进 requestAnimationFrame，避免频繁测量 scrollHeight 触发布局抖动。
const optimizedResizeHandler = debounce(() => {
  requestAnimationFrame(() => {
    const orderBodies = document.querySelectorAll('.sorder-body')
    orderBodies.forEach((orderBody) => {
      checkOverflow(orderBody)
    })
  })
}, 500) // 500ms 的延迟

// 监听全局 resize，同步刷新所有可能出现省略号的手牌/标记镜像容器。
window.addEventListener('resize', optimizedResizeHandler)

/**
 * 根据宿主座位矩形重排每个座位旁的手牌/标记镜像容器。
 * 宿主未提供座位坐标时回退到主面板宽度，避免镜像节点漂移到页面外。
 */
export function drawSeatUIs() {
  const seatUI = document.getElementById('seatUI')
  if (!seatUI) return

  if (UI.seatUIs.length === 0) {
    clearZoneMirrors()
    return
  }

  const defaultWidth = (UI.unscaledWidth + UI.paddingRight) * UI.scale

  for (const seat of UI.seatUIs) {
    if (!hasSeatPosition(seat)) continue

    const displayID = getSeatDisplayID(seat)
    const orderContainer = document.getElementById('or' + displayID)
    if (!orderContainer) continue

    applySeatContainerLayout(orderContainer, seat, defaultWidth)
    ensureSeatOrderBody(orderContainer, displayID).className = `sorder-body sNo${displayID}`
  }

  // drawDeckEdgeUI()
}

function hasSeatPosition(seat) {
  return (
    Number.isFinite(seat?.posX) &&
    Number.isFinite(seat?.posY) &&
    typeof seat.actualSeatID !== 'undefined'
  )
}

function getSeatDisplayID(seat) {
  return typeof seat.order === 'number' ? seat.order + 1 : seat.actualSeatID
}

function applySeatContainerLayout(orderContainer, seat, defaultWidth) {
  orderContainer.style.top = seat.posY + 'px'
  orderContainer.style.left = seat.posX + 'px'
  orderContainer.style.width = (seat.width || defaultWidth) + 'px'
}

function ensureSeatOrderBody(orderContainer, displayID) {
  let orderBody = orderContainer.querySelector('#s' + displayID)
  if (!orderBody) {
    orderBody = document.createElement('div')
    orderBody.id = 's' + displayID
    orderContainer.appendChild(orderBody)
  }

  return orderBody
}

function buttonRes(text, title = '点击复制', encode = true, disable = false, _callback = null) {
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

function getResultContainer() {
  const resDiv = document.getElementById('result')
  if (resDiv) clearElement(resDiv)
  return resDiv
}

function showTextResult(container, text) {
  container.innerHTML = `<span class="textRes">${text}</span>`
}

/**
 * 将卡牌点数规整为 1-13 的有序数组。
 * 技能小抄都以点数集合为输入，花色/牌名展示在调用方处理。
 * @param {unknown[]} array
 * @returns {number[]}
 */
function normalizeCardNumbers(array) {
  return (array || [])
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= 13)
    .sort((a, b) => a - b)
}

function formatCardNumbers(numbers, useAce = true) {
  return numbers.map((number) => n2N(number, useAce)).join('+')
}

function countCardNumbers(numbers) {
  const counts = Array(14).fill(0)

  numbers.forEach((number) => {
    counts[0] += 1
    counts[number] += 1
  })

  return counts
}

function getCountedNumbersTotal(counts) {
  return counts.reduce((sum, count, number) => sum + count * number, 0)
}

function formatNumberCounts(counts) {
  return counts.flatMap((count, number) =>
    number > 0 ? Array(count).fill(n2N(number, false)) : []
  )
}

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

function createYanJiaoButton(left, right, remain, allot) {
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

  if (allot) {
    button.title = '点击"="左侧或右侧的数字，将被点击一侧的数字分配给自己，另一侧的分配给张昌蒲'
    spanA.className = 'yanjiaospan'
    spanB.className = 'yanjiaospan'
    spanA.onclick = function (event) {
      event.stopPropagation()
      laya.yanJiao([left, right, remain], 2)
    }
    spanB.onclick = function (event) {
      event.stopPropagation()
      laya.yanJiao([left, right, remain], 0)
    }
  }

  return button
}

/**
 * 张昌蒲【严教】小抄：寻找两组点数和相等的分牌方案。
 * counts[0] 保存总张数，后续下标保存对应点数张数，便于快速做多重集合扣减。
 * @param {number[]} array
 * @param {boolean} allot
 */
export function drawYanJiao(array, allot = false) {
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
    for (const [left, right, remain] of pairsByRemain) {
      fragment.appendChild(createYanJiaoButton(left, right, remain, allot))
      rendered += 1
      if (rendered >= 5) break
    }
    if (rendered >= 5) break
  }

  if (!rendered) {
    showTextResult(resDiv, '【严教】无解！')
    return
  }

  if (allot) {
    resDiv.insertAdjacentHTML(
      'afterbegin',
      '界小抄：点下方数字可以自动分配牌<br>点击想要分配给自己的一组数字即可'
    )
  }
  resDiv.appendChild(fragment)
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
      const result = temp.slice()
      result.K = K && sum === 13 ? temp.length : 0
      results.push(result)
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
    .filter((subset, _, self) => !self.some((superSet) => isStrictMultisetSubset(subset, superSet)))
    .sort((a, b) => (b.K || 0) - (a.K || 0) || b.length - a.length)

  for (const result of visibleResults) {
    const button = buttonRes(formatCardNumbers(result, false))
    if (K && result.K) button.classList.add('textRes')
    fragment.appendChild(button)
  }

  resDiv.appendChild(fragment)
}

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
