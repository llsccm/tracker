import { clearElement } from '@/draw/drawHelpers'
import { laya } from '@/runtime/gameAdapter'
import { UI } from '@/tracker'
import { checkEllipsisOverflow } from './overflowEllipsis'

let deckEdgeButtons = []
let deckEdgeSignature = ''
let deckEdgeRenderedSignature = ''

export function createDeckEdgeOverlay() {
  const deck = document.createElement('div')
  deck.id = 'deckEdgeUI'
  deck.className = 'sorderContainer deckEdgeUI'
  deck.style.display = 'none'
  return deck
}

export function resetDeckEdgeOverlay() {
  deckEdgeButtons = []
  deckEdgeSignature = ''
  deckEdgeRenderedSignature = ''

  const deck = document.getElementById('deckEdgeUI')
  if (!deck) return

  deck.replaceChildren()
  deck.style.display = 'none'
}

/**
 * 根据回合信息条与座位矩形计算牌堆边缘镜像位置，当前未接通渲染调用。
 * 宿主坐标可能是缩放前或缩放后的值，因此同时兼容 UI.gameRoundRect 与 Laya 原始对象。
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

/** 找到回合信息条左侧最近的座位矩形，限制牌堆镜像最大宽度。 */
function getNearestSeatRectBeforeRound(roundX, roundY) {
  let nearest = null

  for (const seat of UI.nativeSeatRects || []) {
    if (seat.right > roundX || seat.bottom <= roundY) continue
    if (!nearest || seat.right > nearest.right) nearest = seat
  }

  return nearest
}

/** 渲染牌堆顶/底边缘镜像，依赖座位布局完成后计算可用宽度。 */
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

function cloneCardButton(button) {
  const clone = button.cloneNode(true)
  clone.removeAttribute('id')
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
  return clone
}
