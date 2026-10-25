import { getPlayerLocationCandidates } from '@/tracker/candidate/locationCandidate'
import type { Card } from '@/tracker/model'
import type { Room } from '@/tracker/Room'
import { getPopupSpaceCards } from './popupSpaces'
import type { RoomMoveContext } from './types'
import type {
  PlayerLocationCandidate,
  SeatID,
  SpellID,
  SubZone,
  SubZoneCandidate
} from '@/tracker/types'

// 只读取当前 Room / Card，不保存快照或推断状态；供来源、候选和暗置标记组件共用。

/**
 * 将当前可能玩家位置投影为子区读面，不从 seats 反向拼装候选。
 */
export function getCardSubZoneCandidates(card: Card): SubZoneCandidate[] {
  return getCardPlayerLocationCandidates(card).map(({ seatID, subZone, spellID }) => ({
    seatID,
    subZone,
    spellID
  }))
}

/**
 * 筛出未决候选或确定事实中的玩家位置，不把容器或公共位置猜成玩家位置。
 */
export function getCardPlayerLocationCandidates(card: Card): PlayerLocationCandidate[] {
  return getPlayerLocationCandidates(card.getPossibleLocations())
}

/**
 * 收集某玩家指定子区的暗牌来源，并把位置已确定的实体排在跨位置候选之前。
 * 协议只证明“某张暗牌来自该玩家”时，应优先消耗确定来源实体，不能因 Room.cards
 * 的物理顺序碰巧先命中跨座位候选，就提前收敛随机转移约束。
 * spellID 仅限定标记空间；null 表示不限定，0 仍按具体 ID 匹配。
 */
export function getUnknownPlayerSourceCards(
  room: Room,
  seatID: SeatID,
  subZone: SubZone = 'hand',
  spellID: SpellID | null = null,
  excludedCards: Iterable<Card> = []
): Card[] {
  const exactCards: Card[] = []
  const candidateCards: Card[] = []
  const excluded = new Set(excludedCards)

  for (const card of room.cards) {
    if (excluded.has(card)) continue

    if (card.isKnown === true || card.suspended === true) continue

    const hasSourceCandidate = getCardPlayerLocationCandidates(card).some(
      (candidate) =>
        candidate.seatID === seatID &&
        candidate.subZone === subZone &&
        (subZone !== 'mark' || spellID === null || candidate.spellID === spellID)
    )

    if (!hasSourceCandidate) continue

    const isExactSource = isExactUnknownPlayerSourceCard(card, seatID)
    if (isExactSource) exactCards.push(card)
    else candidateCards.push(card)
  }

  return [...exactCards, ...candidateCards]
}

/**
 * 判断未公开、非暂停的玩家实体是否已确定属于该席位；子区匹配由调用方先筛选。
 * 即使只剩单席位，只要仍有完整位置或子区候选，就不能当作精确来源。
 */
export function isExactUnknownPlayerSourceCard(card: Card, seatID: SeatID | null): boolean {
  return (
    seatID !== null &&
    card.location === 'player' &&
    card.isKnown !== true &&
    card.suspended !== true &&
    card.owner === seatID &&
    !card.hasLocationCandidates()
  )
}

/** 明确的弹窗端点只查对应空间，玩家端点只查座位子区。 */
export function getUnknownStoredSourceCards(
  room: Room,
  context: RoomMoveContext,
  excludedCards: Iterable<Card> = []
): Card[] {
  if (context.fromZone === 'popup') {
    const excluded = new Set(excludedCards)
    return getPopupSpaceCards(room, context.fromPopupSpaceID).filter(
      (card) => !card.isKnown && !card.hasLocationCandidates() && !excluded.has(card)
    )
  }
  if (context.fromSeat === null) return []
  return getUnknownPlayerSourceCards(
    room,
    context.fromSeat,
    context.fromSubZone,
    context.fromSpellID ?? context.spellID,
    excludedCards
  )
}

/**
 * 只选择指定数量的玩家暗牌来源，保持精确来源优先及同类实体顺序。
 * 不摘区、不搬牌、不收敛；非正张数返回空数组。
 */
export function takeUnknownCardsFromPlayer(
  room: Room,
  seatID: SeatID,
  count: number,
  subZone: SubZone = 'hand',
  spellID: SpellID | null = null
): Card[] {
  if (!(count > 0)) return []
  return getUnknownPlayerSourceCards(room, seatID, subZone, spellID).slice(0, count)
}

/**
 * 收集某座位当前仍在手牌区的实体牌，包含明牌、暗牌和候选明牌。
 */
export function getPlayerHandCardsBySeat(room: Room, seatID: SeatID): Card[] {
  return room
    .refreshPlayerSnapshot()
    .filter((card) => card.subZone === 'hand' && card.seats.has(seatID))
}

/**
 * 收集某座位当前手牌中的已知实体，用于随机获得/回牌堆时传播明牌候选。
 */
export function getKnownHandCardsBySeat(room: Room, seatID: SeatID): Card[] {
  return getPlayerHandCardsBySeat(room, seatID).filter((card) => card.isKnown === true)
}
