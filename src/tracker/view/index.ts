import { getPanelContentInner } from '@/ui/frameContent'
import { reapplyHiddenTrackerVisibility } from '@/ui/trackerVisibility'
import { buildCardTypeButtons, renderStatistics } from './StatisticsView'
import { renderQueryPanel } from './QueryPanelView'
import {
  clearRenderedMainHandCardIDs,
  clearSeatOverlayCards,
  initPlayerHandContainers,
  renderPlayerHand,
  renderPublicZones
} from './PlayerHandView'
import {
  collectDirtyRenderState,
  finishDirtyRender,
  markFullPlayerRender
} from './dirtyRenderState'
import type { Player } from '../Player'
import type { Room } from '../Room'

let currentRoom: Room | null = null
let doc: Document | null = null
let rafScheduled = false
let seatOverlayLayoutBound = false

/**
 * 挂载记牌器视图
 * 玩家注册后先清理并初始化固定手牌容器；牌堆 ready 后再补齐统计与完整渲染。
 */
export function mount(room: Room | null): void {
  if (!room) {
    doUnmount()
    return
  }

  const isNewRoom = currentRoom !== room || !doc
  if (isNewRoom) {
    doUnmount()
    currentRoom = room
    doc = document
    clearRenderedContent(doc)
  }

  if (!currentRoom || !doc) return

  if (isNewRoom || !currentRoom.isDeckReady) {
    initPlayerHandContainers(doc, currentRoom)
  }

  syncTrackerVisibility(doc)
  if (!currentRoom.isDeckReady) return

  buildCardTypeButtons(currentRoom, doc, setQuery)
  currentRoom.markViewDirty('tracker-view-mount')
  markFullPlayerRender(currentRoom)
  bindSeatOverlayLayout()
  scheduleRender()
}

/** 卸载重构版记牌器视图并清空主面板中的动态记牌器内容 */
export function unmount(): void {
  doUnmount()
}

function doUnmount(): void {
  if (doc) {
    clearRenderedContent(doc)
  }
  clearRenderedMainHandCardIDs()
  doc = null
  currentRoom = null
  rafScheduled = false
}

/**
 * 请求下一帧按脏状态重绘统计、公共区、玩家明牌和查询面板
 * 一帧内多次调用只执行一次
 */
export function scheduleRender(): void {
  if (!currentRoom?.isDeckReady || !doc) return
  if (rafScheduled) return
  rafScheduled = true
  requestAnimationFrame(() => {
    rafScheduled = false
    flushRender()
  })
}

function flushRender(): void {
  if (!currentRoom?.isDeckReady || !doc) return
  const renderState = collectDirtyRenderState(currentRoom)

  // 没有新的脏牌、面板状态或强制全量请求时，跳过本帧全部 DOM 操作。
  if (
    !renderState.shouldRenderPanels &&
    !renderState.shouldRenderAllPlayers &&
    renderState.affectedSeatIDs.size === 0
  ) {
    return
  }

  if (renderState.shouldRenderPanels) {
    renderStatistics(currentRoom, doc)
    renderPublicZones(currentRoom, doc)
  }

  const shouldRenderPlayerHands =
    renderState.shouldRenderAllPlayers || renderState.affectedSeatIDs.size > 0
  const playerOrderResolved = hasResolvedPlayerOrder(currentRoom)
  const players = getPlayersForRender(currentRoom, renderState)
  players.forEach((player) => {
    renderPlayerHand(doc, player)
  })

  if (renderState.shouldRenderPanels) renderQueryPanel(currentRoom, doc)
  syncTrackerVisibility(doc)
  if (shouldRenderPlayerHands && !playerOrderResolved) return
  finishDirtyRender(currentRoom, renderState)
}

/**
 * 设置查询条件并重绘查询面板
 * @param dimension - 'nameIndex' | 'numberIndex' | 'colorIndex' | 'typeIndex'
 */
export function setQuery(dimension: string, key: string | number): void {
  if (!currentRoom?.isDeckReady || !doc) return
  currentRoom.counter.query(dimension as any, key)
  renderQueryPanel(currentRoom, doc)
}

/** 清空全部记牌器容器并重建 cardType 按钮（对应 Game.reset） */
export function reset(): void {
  if (!doc || !currentRoom) return

  clearRenderedContent(doc)
  initPlayerHandContainers(doc, currentRoom)
  if (!currentRoom.isDeckReady) return
  buildCardTypeButtons(currentRoom, doc, setQuery)
  currentRoom.markViewDirty('tracker-view-reset')
  markFullPlayerRender(currentRoom)
  scheduleRender()
}

function clearRenderedContent(targetDoc: Document): void {
  for (const id of ['type1', 'type2', 'type3', 'type4']) {
    targetDoc.getElementById(id)?.replaceChildren()
  }

  getPanelContentInner(targetDoc.getElementById('button'))?.replaceChildren()

  for (const id of ['paiduiCards', 'qipaiCards', 'knownCards', 'cardTypeDetail']) {
    targetDoc.getElementById(id)?.replaceChildren()
  }

  targetDoc.querySelectorAll('#seatUI .sorder-body').forEach((element) => {
    if (element instanceof HTMLElement) clearSeatOverlayCards(element)
  })
}

function bindSeatOverlayLayout(): void {
  if (seatOverlayLayoutBound) return
  seatOverlayLayoutBound = true
  window.addEventListener('dxc-seat-overlay-layout', () => {
    if (currentRoom) {
      currentRoom.markViewDirty('seat-overlay-layout')
      markFullPlayerRender(currentRoom)
    }
    scheduleRender()
  })
}

function getPlayersForRender(
  room: Room,
  renderState: ReturnType<typeof collectDirtyRenderState>
): Player[] {
  if (!hasResolvedPlayerOrder(room)) {
    return []
  }

  if (renderState.shouldRenderAllPlayers) {
    // 首次挂载、座位重排或脏事件日志溢出时，保守重绘所有玩家手牌。
    return getOrderedPlayers(room)
  }

  return getOrderedPlayers(room).filter((player) => renderState.affectedSeatIDs.has(player.seatID))
}

function getOrderedPlayers(room: Room): Player[] {
  return Array.from(room.players.values()).sort((a, b) => {
    return (a.fixedViewId ?? Number.MAX_SAFE_INTEGER) - (b.fixedViewId ?? Number.MAX_SAFE_INTEGER)
  })
}

function hasResolvedPlayerOrder(room: Room): boolean {
  if (room.firstID === undefined || room.firstID === null) return false
  return Array.from(room.players.values()).every((player) => Number.isFinite(player.fixedViewId))
}

function syncTrackerVisibility(targetDoc: Document): void {
  reapplyHiddenTrackerVisibility(targetDoc)
  const content = targetDoc.getElementById('button')
  getPanelContentInner(content)
  content?.style.removeProperty('max-height')
}
