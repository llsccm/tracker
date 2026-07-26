import { SkillsConfig } from '@/config'
import { getPanelContentInner } from '@/ui/frameContent'
import { Game, UI } from '../index'
import { getPileDisplayCards } from '../helper/pileOrder'
import { createCardButton, createUnknownButton } from './cardButton'
import { getPublicFieldCandidateCards } from './publicFieldCandidates'
import type { Card } from '../Card'
import type { Player } from '../Player'
import type { Room } from '../Room'
import { checkEllipsisOverflow, invalidateEllipsisOverflow } from '@/ui/overflowEllipsis'

let renderedMainHandCardIDs: number[] | null = null
const renderedMainHandListeners = new Set<() => void>()

export function getRenderedMainHandCardIDs(): number[] | null {
  return renderedMainHandCardIDs?.slice() ?? null
}

export function subscribeRenderedMainHandCardIDs(listener: () => void): () => void {
  renderedMainHandListeners.add(listener)
  return () => renderedMainHandListeners.delete(listener)
}

export function clearRenderedMainHandCardIDs(): void {
  renderedMainHandCardIDs = null
}

function updateRenderedMainHandCardIDs(cardIDs: number[]): void {
  if (
    renderedMainHandCardIDs !== null &&
    renderedMainHandCardIDs.length === cardIDs.length &&
    renderedMainHandCardIDs.every((id, index) => id === cardIDs[index])
  ) {
    return
  }

  renderedMainHandCardIDs = cardIDs
  renderedMainHandListeners.forEach((listener) => listener())
}

interface CardListOptions {
  ambiguous?: boolean
}

/**
 * 按本局人数初始化武将手牌容器；后续渲染只更新容器内的动态牌节点。
 */
export function initPlayerHandContainers(doc: Document, room: Room): void {
  const panel: HTMLElement | null = getPlayerHandPanel(doc)
  if (!panel) return

  panel.replaceChildren()

  const playerCount = Math.max(room.size, room.players.size)
  for (let displayID = 1; displayID <= playerCount; displayID++) {
    panel.appendChild(createPlayerHandContainer(doc, displayID))
  }
}

function createPlayerHandContainer(doc: Document, displayID: number): HTMLElement {
  const container = doc.createElement('div')
  container.className = 'orderContainer'
  container.id = 'playerHand' + displayID
  container.style.setProperty('--No-content', `'${getDisplayIdLabel(displayID)}号位'`)

  const body = doc.createElement('div')
  body.className = 'order-body No' + displayID
  body.id = String(displayID)
  container.appendChild(body)

  return container
}

/**
 * 渲染单个玩家的武将手牌明牌区：确定明牌 + 模糊明牌(候选席位角标) + 标记牌(按技能分组)
 * 容器 #playerHand<order+1> 内的 .order-body，按 syncViewGroups 稳定顺序重建
 */
export function renderPlayerHand(doc: Document, player: Player): void {
  const displayID = Number(player.fixedViewId)
  if (!Number.isFinite(displayID)) return

  const panel: HTMLElement | null = getPlayerHandPanel(doc)
  const body = panel?.querySelector<HTMLElement>('#playerHand' + displayID + ' > .order-body')
  if (!body) return

  body.querySelectorAll(':scope > .shoupai, :scope > .markedCard').forEach((e) => e.remove())

  const fragment = doc.createDocumentFragment()

  for (const card of player.knownHandCards) {
    fragment.appendChild(createCardButton(doc, card))
  }

  for (const card of player.candidateHandCards) {
    fragment.appendChild(createCardButton(doc, card, { ambiguous: true }))
  }

  const markSpell = SkillsConfig.GetInstance().markSpell

  player.markCards.forEach((cards, spellID) => {
    if (!cards || !cards.length) return

    const markedCard = doc.createElement('div')
    markedCard.className = 'markedCard'

    const mark = doc.createElement('span')
    mark.className = 'mark'
    mark.textContent = markSpell[spellID] ?? String(spellID)
    markedCard.appendChild(mark)

    for (const card of cards) {
      markedCard.appendChild(
        createCardButton(doc, card, { ambiguous: card.hasSubZoneCandidates?.() === true })
      )
    }

    fragment.appendChild(markedCard)
  })

  body.appendChild(fragment)
  syncSeatOverlayHand(doc, displayID, body)

  if (Number(player.seatID) === Number(player.room.mySeatID)) {
    updateRenderedMainHandCardIDs(
      player.knownHandCards.map((card) => Number(card.id)).filter((id) => id > 0)
    )
  }
}

function getPlayerHandPanel(doc: Document): HTMLElement | null {
  return getPanelContentInner(doc.getElementById('button')) as HTMLElement | null
}

function getDisplayIdLabel(displayID: number): string {
  return UI.ORDER_LABELS[displayID] ?? String(displayID)
}

/**
 * 渲染公共牌区：牌堆 → #paiduiCards，本回合弃牌 → #qipaiCards，场上模糊明牌 → #knownCards
 * 连续暗牌合并为单张占位按钮
 */
export function renderPublicZones(room: Room, doc: Document): void {
  const publicByZone = room.locationIndex?.publicByZone
  const pileCards = publicByZone?.get('pile') ?? room.zones.get('pile')?.cards ?? []
  renderCardList(doc, 'paiduiCards', getPileDisplayCards(pileCards))

  const discardCards = (
    publicByZone?.get('discard') ??
    room.zones.get('discard')?.cards ??
    []
  ).filter((card) => card.turn === Game.turn && card.round === Game.round)
  renderCardList(doc, 'qipaiCards', discardCards)

  const fieldCards = getPublicFieldCandidateCards(room)
  renderCardList(doc, 'knownCards', fieldCards, { ambiguous: true })
}

/**
 * 将卡牌列表渲染进指定容器，连续暗牌合并为单张
 */
function renderCardList(
  doc: Document,
  containerId: string,
  cards: Card[],
  options: CardListOptions = { ambiguous: false }
): void {
  const container = doc.getElementById(containerId)
  if (!container) return
  container.querySelectorAll(':scope > .shoupai, :scope > .markedCard').forEach((e) => e.remove())

  let i = 0
  while (i < cards.length) {
    const card = cards[i]
    if (card.isKnown) {
      container.appendChild(createCardButton(doc, card, { ambiguous: options.ambiguous }))
      i++
    } else {
      let run = 1
      while (i + run < cards.length && !cards[i + run].isKnown) run++
      container.appendChild(createUnknownButton(doc, run))
      i += run
    }
  }
}

function syncSeatOverlayHand(doc: Document, displayID: number, body: HTMLElement): void {
  const target = doc.querySelector<HTMLElement>('#seatUI #s' + displayID)
  if (!target) return

  clearSeatOverlayCards(target)

  body.querySelectorAll(':scope > .shoupai, :scope > .markedCard').forEach((node) => {
    target.appendChild(cloneRenderedNode(node))
  })
  checkSeatOverlayOverflow(target)
}

/** 清空座位镜像内容，并同步清掉可能残留的省略号标记。 */
export function clearSeatOverlayCards(orderBody: HTMLElement): void {
  invalidateEllipsisOverflow(orderBody)
  orderBody.querySelectorAll(':scope > .shoupai, :scope > .markedCard').forEach((e) => e.remove())
}

function cloneRenderedNode(node: Element): Element {
  const clone = node.cloneNode(true) as Element
  clone.removeAttribute('id')
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
  return clone
}

/** 按当前布局刷新座位镜像省略号；清理/重绘会使未执行的测量失效。 */
export function checkSeatOverlayOverflow(orderBody: Element): void {
  checkEllipsisOverflow(orderBody)
}
