import { SkillsConfig } from '@/config'
import { getPanelContentInner } from '@/ui/frameContent'
import { Game } from '../index'
import { getPileDisplayCards } from '../helper/pileOrder'
import { formatPlayerSeatLabel, getDisplayIdLabel } from '../helper/seatLabel'
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

type HandCardKind = 'known' | 'candidate'

const RENDER_NODE_CLASS_NAMES = ['shoupai', 'markedCard'] as const
const RENDER_NODE_SELECTOR = RENDER_NODE_CLASS_NAMES.map(
  (className) => `:scope > .${className}`
).join(', ')
const RENDER_KEY_ATTRIBUTE = 'data-tracker-render-key'

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

/** 将玩家武将名和顺位标签写入座位覆盖层。 */
export function updateSeatLabel(
  doc: Document,
  player: Pick<Player, 'fixedViewId' | 'generals'>,
  orderLabels: readonly string[]
): void {
  const fixedViewId = player.fixedViewId ?? 1
  const container = doc.getElementById('playerHand' + fixedViewId)
  if (!container) return

  container.style.setProperty('--No-content', `"${formatPlayerSeatLabel(player, { orderLabels })}"`)
}

/**
 * 渲染单个玩家的武将手牌明牌区：确定明牌 + 模糊明牌(候选席位角标) + 标记牌(按技能分组)
 * 容器 #playerHand<order+1> 内的 .order-body，按 syncViewGroups 稳定顺序增量同步
 */
export function renderPlayerHand(doc: Document, player: Player): void {
  const displayID = Number(player.fixedViewId)
  if (!Number.isFinite(displayID)) return

  const panel: HTMLElement | null = getPlayerHandPanel(doc)
  const body = panel?.querySelector<HTMLElement>('#playerHand' + displayID + ' > .order-body')
  if (!body) return

  const renderedNodes: Element[] = []

  for (const card of player.knownHandCards) {
    renderedNodes.push(createHandCardNode(doc, card, 'known'))
  }

  for (const card of player.candidateHandCards) {
    renderedNodes.push(createHandCardNode(doc, card, 'candidate', true))
  }

  const markSpell = SkillsConfig.GetInstance().markSpell

  player.markCards.forEach((cards, spellID) => {
    if (!cards || !cards.length) return
    renderedNodes.push(createMarkedCardNode(doc, spellID, cards, markSpell[spellID]))
  })

  reconcileRenderedNodes(body, renderedNodes)
  syncSeatOverlayHand(doc, displayID, body)

  if (Number(player.seatID) === Number(player.room.mySeatID)) {
    updateRenderedMainHandCardIDs(
      player.knownHandCards.map((card) => Number(card.id)).filter((id) => id > 0)
    )
  }
}

function createHandCardNode(
  doc: Document,
  card: Card,
  kind: HandCardKind,
  ambiguous = false
): HTMLButtonElement {
  const button = createCardButton(doc, card, { ambiguous })
  return setRenderedNodeKey(button, `hand:${kind}:${card.id}`)
}

function createMarkedCardNode(
  doc: Document,
  spellID: number,
  cards: Card[],
  configuredLabel: string | undefined
): HTMLElement {
  const markedCard = doc.createElement('div')
  markedCard.className = 'markedCard'

  const label = configuredLabel ?? String(spellID)
  const mark = doc.createElement('span')
  mark.className = 'mark'
  mark.textContent = label
  markedCard.appendChild(mark)

  cards.forEach((card) => {
    const button = createCardButton(doc, card, {
      ambiguous: card.hasSubZoneCandidates?.() === true
    })
    markedCard.appendChild(button)
  })

  return setRenderedNodeKey(markedCard, `mark:${spellID}`)
}

function setRenderedNodeKey<T extends Element>(node: T, key: string): T {
  node.setAttribute(RENDER_KEY_ATTRIBUTE, key)
  return node
}

function reconcileRenderedNodes(container: Element, desiredNodes: Element[]): void {
  const currentNodes = getDirectRenderedNodes(container)
  const currentByKey = new Map<string, Element>()

  currentNodes.forEach((node) => {
    const key = node.getAttribute(RENDER_KEY_ATTRIBUTE)
    if (key && !currentByKey.has(key)) currentByKey.set(key, node)
  })

  const retainedNodes = new Set<Element>()
  const nextNodes = desiredNodes.map((desiredNode) => {
    const key = desiredNode.getAttribute(RENDER_KEY_ATTRIBUTE)
    const currentNode = key ? currentByKey.get(key) : undefined
    if (key) currentByKey.delete(key)

    if (currentNode && hasSameRenderedContent(currentNode, desiredNode)) {
      retainedNodes.add(currentNode)
      return currentNode
    }

    return desiredNode
  })

  currentNodes.forEach((node) => {
    if (!retainedNodes.has(node)) node.remove()
  })

  let cursor = getDirectRenderedNodes(container)[0] ?? null
  nextNodes.forEach((node) => {
    if (node === cursor) {
      cursor = getNextRenderedSibling(cursor)
      return
    }

    container.insertBefore(node, cursor)
  })
}

/** 比较渲染器负责的内容；忽略显隐逻辑可能写入的内联 style。 */
function hasSameRenderedContent(current: Element, desired: Element): boolean {
  if (current.tagName !== desired.tagName) return false
  if (current.className !== desired.className) return false
  if (current.getAttribute('id') !== desired.getAttribute('id')) return false
  if (current.getAttribute('title') !== desired.getAttribute('title')) return false
  if (current.getAttribute('aria-disabled') !== desired.getAttribute('aria-disabled')) return false

  const currentChildren = Array.from(current.children)
  const desiredChildren = Array.from(desired.children)
  if (currentChildren.length !== desiredChildren.length) return false

  if (currentChildren.length === 0) {
    return current.innerHTML === desired.innerHTML && current.textContent === desired.textContent
  }

  return currentChildren.every((child, index) =>
    hasSameRenderedContent(child, desiredChildren[index])
  )
}

function getDirectRenderedNodes(container: Element): Element[] {
  return Array.from(container.querySelectorAll(RENDER_NODE_SELECTOR))
}

function getNextRenderedSibling(node: Element): Element | null {
  let sibling = node.nextElementSibling
  while (sibling && !isRenderedNode(sibling)) sibling = sibling.nextElementSibling
  return sibling
}

function isRenderedNode(node: Element): boolean {
  return RENDER_NODE_CLASS_NAMES.some((className) => node.classList.contains(className))
}

function getPlayerHandPanel(doc: Document): HTMLElement | null {
  return getPanelContentInner(doc.getElementById('button')) as HTMLElement | null
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
  container.querySelectorAll(RENDER_NODE_SELECTOR).forEach((e) => e.remove())

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

  const renderedNodes = getDirectRenderedNodes(body).map((node) => cloneRenderedNode(node))
  reconcileRenderedNodes(target, renderedNodes)
  checkSeatOverlayOverflow(target)
}

/** 清空座位镜像内容，并同步清掉可能残留的省略号标记。 */
export function clearSeatOverlayCards(orderBody: HTMLElement): void {
  invalidateEllipsisOverflow(orderBody)
  orderBody.querySelectorAll(RENDER_NODE_SELECTOR).forEach((e) => e.remove())
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
