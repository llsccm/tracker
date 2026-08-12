import { CardConfig } from './config'
import { clearElement } from './draw/drawHelpers'
import { checkEllipsisOverflow, invalidateEllipsisOverflow } from './ui/overflowEllipsis'
import { UI } from './tracker'
import { laya } from './runtime/gameAdapter'
import { getCardFaceHtml } from './utils'
import { toClipboard } from './utils/clipboard'

export { drawChengXiang } from './draw/drawChengXiang'
export { drawMiZhu } from './draw/drawMiZhu'
export { drawYanJiao } from './draw/drawYanJiao'
export { drawYiCheng } from './draw/drawYiCheng'

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

  for (const id of shoupai) {
    if (id == '0') continue
    const button = document.createElement('button')
    const card = CardConfig.GetInstance().getCard(id)
    button.classList.add('shoupai')
    button.classList.toggle('red-card', card.color <= 2)
    button.innerHTML = getCardFaceHtml(card)
    fragment.appendChild(button)
  }

  clearElement(toBeAdd)
  toBeAdd.appendChild(fragment)
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
  if (!(element instanceof HTMLElement)) return
  invalidateEllipsisOverflow(element)
  element.querySelectorAll(':scope > .shoupai, :scope > .markedCard').forEach((e) => e.remove())
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
    checkEllipsisOverflow(existing, 40)
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
  checkEllipsisOverflow(edge, 40)
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
      checkEllipsisOverflow(orderBody, 40)
    })
  })
}, 500) // 500ms 的延迟

// 监听全局 resize，同步刷新所有可能出现省略号的手牌/标记镜像容器。
window.addEventListener('resize', optimizedResizeHandler)

/**
 * 根据宿主座位矩形重排每个座位旁的手牌/标记镜像容器。
 * 宿主未提供座位坐标时回退到主面板宽度，避免镜像节点漂移到页面外。
 */
/** 只计算并写入座位位置；容器可见性由首轮流程控制。 */
export function drawSeatUIs() {
  const seatUI = document.getElementById('seatUI')
  if (!seatUI) return false

  const seats = UI.seatUIs.slice(1)
  if (seats.length === 0 || seats.some((seat) => !hasSeatPosition(seat))) return false

  // 此处计算 手牌框宽度 存在一个问题 某些情况下缩放比例不太正确
  // 假设游戏缩放 那应该变大吗? 假设系统缩放呢?
  // 假设系统缩放是1.0 游戏缩放1.5 手牌框就会变大 实际上武将框渲染的很小
  // 假设系统缩放是1.0 游戏缩放1.0 高分屏武将框不变,间隙很大,这时手牌框应该要变大
  // 手牌框需要变大的情况寥寥无几 不用乘上游戏缩放感觉会更好
  // * UI.scale / window.devicePixelRatio
  const defaultWidth = UI.unscaledWidth + UI.paddingRight

  const layouts = seats.map((seat) => {
    const displayID = seat.fixedViewId
    const orderContainer = seatUI.querySelector('#or' + displayID)
    return { displayID, orderContainer, seat }
  })
  if (layouts.some(({ orderContainer }) => !orderContainer)) return false

  for (const { displayID, orderContainer, seat } of layouts) {
    applySeatContainerLayout(orderContainer, seat, defaultWidth)
    ensureSeatOrderBody(orderContainer, displayID).className = `sorder-body sNo${displayID}`
  }

  UI.firstUpdateSeatUI = true
  window.dispatchEvent(new CustomEvent('dxc-seat-overlay-layout'))
  return true
}

function hasSeatPosition(seat) {
  return (
    Number.isFinite(seat?.posX) && Number.isFinite(seat?.posY) && Number.isFinite(seat?.fixedViewId)
  )
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
