import { clearZoneMirrors } from '@/draw'
import { laya } from '@/runtime/gameAdapter'
import { Game, UI } from '@/tracker'
import { createDeckEdgeOverlay, resetDeckEdgeOverlay } from './deckEdgeOverlay'

const SEAT_TOP_OFFSET = 6

export function createSeatOverlay(config) {
  const seatUI = document.createElement('div')
  seatUI.id = 'seatUI'
  seatUI.style.position = 'absolute'
  seatUI.style.top = '50%'
  seatUI.style.left = '50%'
  seatUI.style.transform = 'translate(-50%, -50%)'
  seatUI.style.pointerEvents = 'none' // 确保点击事件穿透
  seatUI.appendChild(createDeckEdgeOverlay())

  const seatSlotFragment = document.createDocumentFragment()
  for (let i = 1; i <= 8; i++) {
    const orderContainer = document.createElement('div')
    orderContainer.className = 'sorderContainer'
    orderContainer.id = 'or' + i
    orderContainer.style.display = 'none'

    const orderBody = document.createElement('div')
    orderBody.className = 'sorder-body'
    orderBody.classList.add('sNo' + i)
    orderBody.id = 's' + i
    orderContainer.appendChild(orderBody)

    seatSlotFragment.appendChild(orderContainer)
  }
  seatUI.appendChild(seatSlotFragment)
  document.body.appendChild(seatUI)
  setSeatOverlayVisible(config.seatUISwitch)
}

/** @param {import('@/tracker/Room').Room | null} room */
export function updateSeatOverlay(room) {
  const seats = getSeatUIs(room)
  UI.seatUIs = seats

  // 初始化时也同步外层尺寸；座位、场景和 DOM 可以先后就绪。
  if (!syncSeatOverlayViewport() || room?.firstID === undefined || seats.length === 0) return false

  getSeatUiPos(seats)
  return drawSeatUIs(seats)
}

export function resetSeatOverlay() {
  UI.seatUIs = []
  UI.friendGeneral = 0
  clearZoneMirrors()
  resetDeckEdgeOverlay()

  document.querySelectorAll('#seatUI .sorderContainer:not(.deckEdgeUI)').forEach((container) => {
    container.style.display = 'none'
    container.style.visibility = 'hidden'
    container.style.removeProperty('top')
    container.style.removeProperty('left')
    container.style.removeProperty('width')
  })
}

export function setSeatOverlayVisible(visible) {
  const seatUI = document.getElementById('seatUI')
  if (seatUI) seatUI.style.display = visible ? 'block' : 'none'
}

export function destroySeatOverlay() {
  clearZoneMirrors()
  resetDeckEdgeOverlay()
  UI.seatUIs = []
  // 界面重建可以发生在同一局，保留山河图队友信息。
  document.getElementById('seatUI')?.remove()
}

function getSeatUIs(room) {
  if (!room?.seatIDs?.length || room.mySeatID === undefined) return []

  const { seatIDs, players, mySeatID } = room
  const startIndex = seatIDs.indexOf(Number(mySeatID))
  if (startIndex < 0) return []

  // 从主视角开始环排物理座位，保留相对先手的固定顺位。
  return (
    seatIDs
      .map((_, index) => {
        const seatID = seatIDs[(startIndex + index) % seatIDs.length]
        return {
          seatID,
          fixedViewId: players.get(Number(seatID))?.fixedViewId
        }
      })
      // 主视角仅作为布局原点，其余只保留当前显示的玩家。
      .filter((seat, index) => index === 0 || players.get(seat.seatID)?.isShown)
  )
}

function syncSeatOverlayViewport() {
  const scene = laya.scene
  const seatUI = document.getElementById('seatUI')
  if (!scene || !seatUI) return false

  const { width, height } = scene
  if (!width || !height) return false

  // 最终变换包含场景、舞台与 Canvas 适配，游戏上下留白不一定相等。
  const transform = Laya.Utils.getTransformRelativeToWindow(scene, 0, 0)
  const dpr = window.devicePixelRatio
  const app = {
    width: width * transform.scaleX,
    height: height * transform.scaleY
  }
  UI.width = Math.trunc(app.width * dpr)
  UI.height = Math.trunc(app.height * dpr)
  UI.scale = transform.scaleX * dpr
  UI.centerX = transform.x + app.width / 2
  UI.centerY = transform.y + app.height / 2

  seatUI.style.width = `${app.width}px`
  seatUI.style.height = `${app.height}px`
  seatUI.style.left = UI.centerX + 'px'
  seatUI.style.top = UI.centerY + 'px'
  document.documentElement.style.setProperty('--sgs-center-x', `${UI.centerX}px`)
  return true
}

function getSeatUiPos(list) {
  const metrics = getSeatLayoutMetrics()

  UI.ScaleWidth = metrics.seatWidth
  UI.ScaleHeight = metrics.seatHeight

  if (list.length <= 1) return

  const seatCount = getSeatLayoutCount(list)
  let nextIndex = 1

  nextIndex = layoutRightSeats(list, nextIndex, seatCount.right, metrics)
  nextIndex = layoutTopSeats(list, nextIndex, seatCount.top, metrics)
  layoutLeftSeats(list, nextIndex, seatCount.left, metrics)
}

function getSeatLayoutMetrics() {
  const scale = UI.scale

  return {
    scale,
    dpr: window.devicePixelRatio,
    width: UI.width,
    height: UI.height,
    seatWidth: UI.unscaledWidth * scale,
    seatHeight: UI.unscaledHeight * scale,
    selfSeatHeight: UI.selfSeatUiUnscaledHeight * scale,
    rightBarWidth: UI.rightBarWidth * scale,
    topPadding: (UI.paddingTop + 10) * scale
  }
}

function getSeatLayoutCount(list) {
  const otherSeatCount = list.length - 1
  let top = getDefaultTopSeatCount(otherSeatCount)
  let right = (otherSeatCount - top) >> 1
  let left = otherSeatCount - right - top

  // 斗地主按主视角相对先手的固定顺位调整左右侧落点。
  if (Game.isDouDiZhu && list.length === 3) {
    const myFixedViewId = list[0]?.fixedViewId

    if (myFixedViewId === 2) {
      top = 1
      right = 1
      left = 0
    } else if (myFixedViewId === 3) {
      top = 1
      left = 1
      right = 0
    }
  }

  if (Game.isShanHeTu && list.length === 3 && UI.friendGeneral === 1) {
    top = 1
    left = 1
    right = 0
  }

  return { top, right, left }
}

function getDefaultTopSeatCount(otherSeatCount) {
  if (otherSeatCount < 3) return otherSeatCount
  if (otherSeatCount === 3) return 1
  if (otherSeatCount === 4 || otherSeatCount === 6) return 2
  if (otherSeatCount === 5 || otherSeatCount === 7) return 3

  return 0
}

function layoutRightSeats(list, startIndex, count, metrics) {
  if (count <= 0) return startIndex

  const { measuredHeight, gap } = getVerticalSeatLayout(count, metrics)
  const endIndex = startIndex + count
  const x =
    metrics.width - metrics.seatWidth - UI.paddingRight * metrics.scale - metrics.rightBarWidth
  let y = getSideSeatsStartY(measuredHeight, metrics) + measuredHeight

  UI.verticalGap = gap

  for (let index = startIndex; index < endIndex; index += 1) {
    y -= metrics.seatHeight
    setSeatPosition(list[index], 'Right', x - 5, y + metrics.seatHeight, metrics.dpr)
    y -= gap
  }

  return endIndex
}

function layoutTopSeats(list, startIndex, count, metrics) {
  if (count <= 0) return startIndex

  let measuredWidth = metrics.seatWidth * count
  const gap = ((metrics.width - metrics.rightBarWidth - measuredWidth) * 0.07) >> 0
  const endIndex = startIndex + count
  const y = metrics.topPadding + metrics.seatHeight
  measuredWidth += (count - 1) * gap

  let x =
    (metrics.width - measuredWidth - metrics.rightBarWidth) / 2 +
    measuredWidth +
    (metrics.width <= 1600 ? UI.paddingLeftTopExtra : 0)

  UI.horizontalGap = gap

  for (let index = startIndex; index < endIndex; index += 1) {
    x -= metrics.seatWidth
    setSeatPosition(list[index], 'Top', x, y, metrics.dpr)
    x -= gap
  }

  return endIndex
}

function layoutLeftSeats(list, startIndex, count, metrics) {
  if (count <= 0) return startIndex

  const { measuredHeight, gap } = getVerticalSeatLayout(count, metrics)
  const endIndex = startIndex + count
  const x = UI.paddingLeft * metrics.scale
  let y = getSideSeatsStartY(measuredHeight, metrics)

  for (let index = startIndex; index < endIndex; index += 1) {
    setSeatPosition(list[index], 'Left', x, y + metrics.seatHeight, metrics.dpr)
    y += metrics.seatHeight + gap
  }

  return endIndex
}

function getVerticalSeatLayout(count, metrics) {
  let measuredHeight = metrics.seatHeight * count
  const gap = ((metrics.height - metrics.selfSeatHeight - measuredHeight) * 0.25) >> 0
  measuredHeight += (count - 1) * gap

  return { measuredHeight, gap }
}

function getSideSeatsStartY(measuredHeight, metrics) {
  return (
    ((metrics.height -
      metrics.selfSeatHeight -
      measuredHeight -
      UI.paddingTop * metrics.scale -
      UI.paddingBottom) >>
      1) +
    metrics.topPadding +
    UI.leftRightTop * metrics.scale
  )
}

function setSeatPosition(seatUI, displayLocation, x, y, dpr) {
  if (!seatUI) return

  seatUI.DisplayLocation = displayLocation
  seatUI.posX = Math.trunc(x) / dpr
  // 逻辑偏移先按当前布局倍率缩放，再统一换算为 CSS 坐标。
  seatUI.posY = Math.trunc(y + SEAT_TOP_OFFSET * UI.scale) / dpr
}

function drawSeatUIs(list) {
  const seatUI = document.getElementById('seatUI')
  const seats = list.slice(1)
  if (seats.some((seat) => !hasSeatPosition(seat))) return false

  // 明牌框宽度沿用固定 CSS 像素，座位定位按游戏缩放与 DPR 换算。
  const defaultWidth = UI.unscaledWidth + UI.paddingRight
  const layouts = seats.map((seat) => {
    const displayID = seat.fixedViewId
    const orderContainer = seatUI.querySelector('#or' + displayID)
    return { displayID, orderContainer, seat }
  })
  if (layouts.some(({ orderContainer }) => !orderContainer)) return false

  const visibleContainers = new Set(layouts.map(({ orderContainer }) => orderContainer))
  for (const container of seatUI.querySelectorAll('.sorderContainer:not(.deckEdgeUI)')) {
    const isShown = visibleContainers.has(container)
    container.style.display = isShown ? 'flex' : 'none'
    container.style.visibility = isShown && Game.turn > 0 ? 'visible' : 'hidden'
  }

  for (const { displayID, orderContainer, seat } of layouts) {
    applySeatContainerLayout(orderContainer, seat, defaultWidth)
    ensureSeatOrderBody(orderContainer, displayID).className = `sorder-body sNo${displayID}`
  }

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
