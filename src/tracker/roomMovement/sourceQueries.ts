import { fromSubZoneCandidate, getPlayerLocationCandidates } from '../candidate/locationCandidate'
import { getCompatibleMarkSpellIDs } from '../candidate/markSpellID'
import type { Card } from '../Card'
import type { Room } from '../Room'
import type { PlayerLocationCandidate, SeatID, SpellID, SubZone, SubZoneCandidate } from '../types'

// 只读取当前 Room / Card，不保存快照或推断状态；供来源、候选和暗置标记组件共用。

/**
 * 读取兼容的玩家子区候选；无显式子区候选时，按当前玩家区投影展开席位。
 * 不修改牌实体，非玩家区且无子区候选时返回空数组。
 */
export function getCardSubZoneCandidates(card: Card): SubZoneCandidate[] {
  if (card.hasSubZoneCandidates?.()) {
    return card.subZoneCandidates
  }

  if (card.location !== 'player') return []

  const subZone = card.subZone ?? 'hand'
  return Array.from(card.seats).map((seatID) => ({
    seatID: Number(seatID),
    subZone,
    spellID: subZone === 'mark' ? card.spellID : null
  }))
}

/**
 * 以完整位置候选为主模型，只筛出其中的玩家位置；不能用席位投影覆盖容器或公共候选。
 * 仅在没有完整位置候选时回退到兼容子区投影。
 */
export function getCardPlayerLocationCandidates(card: Card): PlayerLocationCandidate[] {
  if (card.hasLocationCandidates?.()) {
    return getPlayerLocationCandidates(card.locationCandidates)
  }

  return getCardSubZoneCandidates(card)
    .map((candidate) => fromSubZoneCandidate(candidate))
    .filter((candidate): candidate is PlayerLocationCandidate => Boolean(candidate))
}

/**
 * 收集某玩家指定子区的暗牌来源，并把位置已确定的实体排在跨位置候选之前。
 * 协议只证明“某张暗牌来自该玩家”时，应优先消耗确定来源实体，不能因 Room.cards
 * 的物理顺序碰巧先命中跨座位候选，就提前收敛随机转移约束。
 */
export function getUnknownPlayerSourceCards(
  room: Room,
  seatID: SeatID,
  subZone: SubZone = 'hand',
  spellIDs: SpellID | SpellID[] = [],
  excludedCards: Iterable<Card> = []
): Card[] {
  const exactCards: Card[] = []
  const candidateCards: Card[] = []
  const excluded = new Set(excludedCards)
  const sourceSpellIDs = Array.isArray(spellIDs) ? spellIDs : [spellIDs]
  const markSpellIDs =
    subZone === 'mark'
      ? Array.from(new Set(sourceSpellIDs.flatMap((spellID) => getCompatibleMarkSpellIDs(spellID))))
      : []
  const matchesSpellID = (spellID: PlayerLocationCandidate['spellID']): boolean =>
    subZone !== 'mark' ||
    markSpellIDs.length === 0 ||
    (spellID !== null && markSpellIDs.includes(spellID))

  for (const card of room.cards) {
    if (excluded.has(card)) continue

    if (card.isKnown === true || card.suspended === true) continue

    const hasSourceProjection =
      card.location === 'player' &&
      card.subZone === subZone &&
      card.seats.has(seatID) === true &&
      matchesSpellID(card.spellID)
    const hasSourceCandidate = getCardPlayerLocationCandidates(card).some(
      (candidate) =>
        Number(candidate.seatID) === Number(seatID) &&
        candidate.subZone === subZone &&
        matchesSpellID(candidate.spellID)
    )

    if (!hasSourceProjection && !hasSourceCandidate) continue

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
export function isExactUnknownPlayerSourceCard(card: Card, seatID: SeatID): boolean {
  return (
    card.location === 'player' &&
    card.isKnown !== true &&
    card.suspended !== true &&
    card.resolvedSeat === Number(seatID) &&
    card.seats.size === 1 &&
    !card.hasLocationCandidates?.() &&
    !card.hasSubZoneCandidates?.()
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
  spellIDs: SpellID | SpellID[] = []
): Card[] {
  if (!(count > 0)) return []
  return getUnknownPlayerSourceCards(room, seatID, subZone, spellIDs).slice(0, count)
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
