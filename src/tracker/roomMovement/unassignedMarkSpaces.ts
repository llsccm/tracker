import type { Card } from '../Card'
import type { Room } from '../Room'
import type { SeatID, SpellID } from '../types'
import { getCompatibleMarkSpellIDs, type SpellIDInput } from '../candidate/markSpellID'
import { UNASSIGNED_MARK_SPACE_STATE_KEY, type UnassignedMarkSpaceState } from './types'

/**
 * 获取无席位 mark 空间账本。
 * 这类空间来自 seatID=255 的弹窗/标记协议，按 spellID 保存暗占位实体。
 */
function getUnassignedMarkSpaceState(room: Room): UnassignedMarkSpaceState {
  return room.ensureSkillState(UNASSIGNED_MARK_SPACE_STATE_KEY, () => {
    return { spaces: new Map<SpellID | string, Card[]>() }
  })
}

/**
 * 判断账本引用是否仍是可用的无席位 mark 暗占位。
 * 取牌和清理都会走这里，避免陈旧引用被再次移动。
 */
function isLiveUnassignedMarkSpaceCard(card: Card, spellIDs: (SpellID | string)[] = []): boolean {
  if (
    card.location !== 'player' ||
    card.subZone !== 'mark' ||
    card.seats.size !== 0 ||
    card.isKnown === true
  ) {
    return false
  }

  if (spellIDs.length === 0) return true
  return card.spellID !== null && spellIDs.includes(card.spellID)
}

/**
 * 将协议 ID 解释为无席位 mark 空间 ID。
 * 只有它不是当前座位且已存在同名 spellID 空间时，才允许从 FromID 推断。
 */
export function getUnassignedMarkSpaceSpellIDFromProtocolID(
  room: Room,
  protocolID: SeatID | null | undefined
): SpellID | null {
  if (protocolID === null || protocolID === undefined || Number.isNaN(protocolID)) return null
  if (room.seatIDs.includes(protocolID)) return null

  const state = room.readSkillState<UnassignedMarkSpaceState>(UNASSIGNED_MARK_SPACE_STATE_KEY)
  return state?.spaces?.has(protocolID) ? protocolID : null
}

/**
 * 将未知牌登记到无席位 mark 空间。
 * 进入弹窗 mark 时目标 seatID 可能是 255，不能绑定到玩家，只能用 spellID 分桶。
 */
export function registerUnassignedMarkSpaceCards(
  room: Room,
  spellID: SpellID | null,
  cards: Card[]
): void {
  if (spellID === null || cards.length === 0) return

  const state = getUnassignedMarkSpaceState(room)
  const liveCards = cards.filter((card) => isLiveUnassignedMarkSpaceCard(card, [spellID]))
  if (liveCards.length === 0) return

  const previousCards = state.spaces.get(spellID) ?? []
  const mergedCards: Card[] = []
  const seenCards = new Set<Card>()
  const candidateCards = [...previousCards, ...liveCards]

  candidateCards.forEach((card) => {
    if (seenCards.has(card) || !isLiveUnassignedMarkSpaceCard(card, [spellID])) return
    seenCards.add(card)
    mergedCards.push(card)
  })

  state.spaces.set(spellID, mergedCards)
}

/**
 * 从无席位 mark 空间弹出暗占位实体。
 * 回牌堆时 FromID 可能是技能空间 ID 而不是座位，优先按 spellID 取账本实体。
 * 如果无法确定 spellID，则不从任何空间兜底取牌，避免串用其它技能空间。
 */
export function takeUnassignedMarkSpaceCards(
  room: Room,
  count: number,
  spellID: SpellIDInput
): Card[] {
  if (!(count > 0)) return []

  const state = room.readSkillState<UnassignedMarkSpaceState>(UNASSIGNED_MARK_SPACE_STATE_KEY)
  if (!state?.spaces?.size) return []

  const compatibleSpellIDs = getCompatibleMarkSpellIDs(spellID)
  if (compatibleSpellIDs.length === 0) return []

  const spaceKeys = compatibleSpellIDs
  const selectedCards: Card[] = []

  spaceKeys.forEach((spaceKey) => {
    const spaceCards = state.spaces.get(spaceKey) ?? []
    if (spaceCards.length === 0) return

    const remainingCards: Card[] = []
    spaceCards.forEach((card) => {
      if (!isLiveUnassignedMarkSpaceCard(card, compatibleSpellIDs)) return

      if (selectedCards.length < count) {
        selectedCards.push(card)
        return
      }

      remainingCards.push(card)
    })

    if (remainingCards.length > 0) {
      state.spaces.set(spaceKey, remainingCards)
    } else {
      state.spaces.delete(spaceKey)
    }
  })

  return selectedCards
}

/**
 * 从所有无席位 mark 空间移除指定实体。
 * 明牌揭示、显式 sourceCards 或公共区回补可能绕过按 spellID 取牌流程。
 */
export function removeUnassignedMarkSpaceCards(room: Room, cards: Card[]): void {
  if (cards.length === 0) return

  const state = room.readSkillState<UnassignedMarkSpaceState>(UNASSIGNED_MARK_SPACE_STATE_KEY)
  if (!state?.spaces?.size) return

  const removedCards = new Set(cards)
  state.spaces.forEach((spaceCards, spaceKey) => {
    const remainingCards = spaceCards.filter(
      (card) => !removedCards.has(card) && isLiveUnassignedMarkSpaceCard(card, [spaceKey])
    )

    if (remainingCards.length > 0) {
      state.spaces.set(spaceKey, remainingCards)
    } else {
      state.spaces.delete(spaceKey)
    }
  })
}
