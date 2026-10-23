import type { Card } from '@/tracker/model/Card'
import type { Room } from '@/tracker/Room'
import { POPUP_SPACE_STATE_KEY, type PopupSpaceState } from './types'

/**
 * 获取临时弹窗空间账本。
 * 区域 8 按归一化的空间 ID 保存明牌、暗槽与候选引用，不依赖玩家座位。
 */
function getPopupSpaceState(room: Room): PopupSpaceState {
  return room.ensureSkillState(POPUP_SPACE_STATE_KEY, () => {
    return { spaces: new Map<number, Card[]>() }
  })
}

/**
 * 判断账本引用是否仍确定或可能属于弹窗空间。
 * 取牌和清理都会走这里，避免陈旧引用被再次移动。
 */
function isLivePopupSpaceCard(card: Card, spaceIDs: number[] = []): boolean {
  if (card.hasLocationCandidates()) {
    return card.locationCandidates.some(
      (candidate) =>
        candidate.type === 'popup' &&
        (spaceIDs.length === 0 || spaceIDs.includes(candidate.spaceID))
    )
  }
  if (card.location !== 'popup') {
    return false
  }

  if (spaceIDs.length === 0) return true
  return card.popupSpaceID !== null && spaceIDs.includes(card.popupSpaceID)
}

/** 空间读面同时包含明牌、匿名槽及仍可能留在本空间的候选身份。 */
export function getPopupSpaceCards(room: Room, spaceID: number): Card[] {
  const state = room.readSkillState<PopupSpaceState>(POPUP_SPACE_STATE_KEY)
  if (!state) return []
  const cards = state.spaces.get(spaceID) ?? []
  const liveCards = cards.filter((card) => isLivePopupSpaceCard(card, [spaceID]))
  if (liveCards.length > 0) state.spaces.set(spaceID, liveCards)
  else state.spaces.delete(spaceID)
  return liveCards
}

/**
 * 将明牌或暗槽登记到弹窗空间。
 * 物理成员与逻辑候选共用空间索引；数组长度不是物理容量。
 */
export function registerPopupSpaceCards(room: Room, spaceID: number | null, cards: Card[]): void {
  if (spaceID === null || cards.length === 0) return

  const state = getPopupSpaceState(room)
  const liveCards = cards.filter((card) => isLivePopupSpaceCard(card, [spaceID]))
  if (liveCards.length === 0) return

  const previousCards = state.spaces.get(spaceID) ?? []
  const mergedCards: Card[] = []
  const seenCards = new Set<Card>()
  const candidateCards = [...previousCards, ...liveCards]

  candidateCards.forEach((card) => {
    if (seenCards.has(card) || !isLivePopupSpaceCard(card, [spaceID])) return
    seenCards.add(card)
    mergedCards.push(card)
  })

  state.spaces.set(spaceID, mergedCards)
}

/**
 * 从弹窗空间弹出暗占位实体。
 * 只读取明确的 spaceID，不从玩家标记或其它弹窗空间补取。
 * 如果无法确定 spaceID，则不从任何空间兜底取牌，避免串用其它技能空间。
 */
export function takePopupSpaceCards(room: Room, count: number, spaceID: number): Card[] {
  if (!(count > 0)) return []

  const state = room.readSkillState<PopupSpaceState>(POPUP_SPACE_STATE_KEY)
  if (!state?.spaces?.size) return []

  const spaceCards = getPopupSpaceCards(room, spaceID)
  const selectedCards: Card[] = []
  const remainingCards: Card[] = []
  const takeWholeSpace =
    spaceCards.length <= count && spaceCards.every((card) => !card.hasLocationCandidates())
  spaceCards.forEach((card) => {
    // 明牌多选一或混合明暗不能按数组顺序选身份；整批移出才有唯一来源集合。
    if (
      card.hasLocationCandidates() ||
      (card.isKnown && !takeWholeSpace) ||
      selectedCards.length >= count
    ) {
      remainingCards.push(card)
      return
    }
    selectedCards.push(card)
  })

  if (remainingCards.length > 0) state.spaces.set(spaceID, remainingCards)
  else state.spaces.delete(spaceID)

  return selectedCards
}

/**
 * 从所有弹窗空间移除指定实体。
 * 明牌揭示、显式 sourceCards 或公共区回补可能绕过按 spaceID 取牌流程。
 */
export function removePopupSpaceCards(room: Room, cards: Card[]): void {
  if (cards.length === 0) return

  const state = room.readSkillState<PopupSpaceState>(POPUP_SPACE_STATE_KEY)
  if (!state?.spaces?.size) return

  const removedCards = new Set(cards)
  state.spaces.forEach((spaceCards, spaceKey) => {
    const remainingCards = spaceCards.filter(
      (card) => !removedCards.has(card) && isLivePopupSpaceCard(card, [spaceKey])
    )

    if (remainingCards.length > 0) {
      state.spaces.set(spaceKey, remainingCards)
    } else {
      state.spaces.delete(spaceKey)
    }
  })
}

/** 身份互换时让匿名替身接管原空间引用，不增加空间名额。 */
export function replacePopupSpaceCard(room: Room, previous: Card, next: Card): void {
  const state = room.readSkillState<PopupSpaceState>(POPUP_SPACE_STATE_KEY)
  if (!state) return
  state.spaces.forEach((cards, spaceID) => {
    if (cards.includes(previous))
      state.spaces.set(
        spaceID,
        cards.map((card) => (card === previous ? next : card))
      )
  })
}

/** 收敛后仅清理已有空间桶，不扫描全牌池。 */
export function reconcilePopupSpaces(room: Room): void {
  const state = room.readSkillState<PopupSpaceState>(POPUP_SPACE_STATE_KEY)
  if (!state) return
  for (const spaceID of state.spaces.keys()) getPopupSpaceCards(room, spaceID)
  if (state.spaces.size === 0) room.deleteSkillState(POPUP_SPACE_STATE_KEY)
}
