import type { Card } from '../model/Card'
import type { Room } from '../Room'
import type { CardID } from '../types'
import { getPositiveIDs } from '../helper/cardIDs'

type KnownCardCommit = {
  card: Card
  cardID: CardID
  materialize: boolean
}

export type ExchangeKnownCardPlan = {
  cards: Card[]
  commits: KnownCardCommit[]
}

/**
 * 只在指定批次内匹配已知身份或分配匿名槽，预检期间不修改实体和身份账本。
 * 调用方仍须校验协议张数与桶容量，再提交计划；失配时不借用其它批次的实体。
 */
export function planExchangeKnownCards(
  room: Room,
  cardIDs: readonly CardID[],
  candidates: readonly Card[]
): ExchangeKnownCardPlan {
  const cards: Card[] = []
  const selected = new Set<Card>()
  const anonymousTargets = candidates.filter((card) => card.isAnonymous)
  const plannedCardsByID = new Map<CardID, Card>()
  const commits: KnownCardCommit[] = []

  for (const cardID of getPositiveIDs(cardIDs)) {
    const existing = candidates.find((card) => card.id === cardID)
    const planned = plannedCardsByID.get(cardID)
    const target = anonymousTargets[0] ?? null
    const card = existing ?? planned ?? room.probeMaterialize(cardID, target)
    if (!card || !candidates.includes(card) || selected.has(card)) continue

    const materialize = !existing && !planned && card === target
    if (materialize) {
      anonymousTargets.shift()
      plannedCardsByID.set(cardID, card)
    }
    selected.add(card)
    cards.push(card)
    commits.push({ card, cardID, materialize })
  }

  return { cards, commits }
}

/** 整批复核后才确认身份，保留预检失败时的原始状态。 */
export function commitExchangeKnownCards(room: Room, plan: ExchangeKnownCardPlan): boolean {
  const canCommit = plan.commits.every(({ card, cardID, materialize }) =>
    materialize ? room.probeMaterialize(cardID, card) === card : card.id === cardID
  )
  if (!canCommit) return false

  plan.commits.forEach(({ card, cardID, materialize }) => {
    if (materialize) {
      room.materialize(cardID, card)
      return
    }
    card.confirmKnown()
  })
  return true
}

/** 明牌经 cardIDs 移动，剩余物理实体经 sourceCards 移动。 */
export function splitExchangeCards(cards: readonly Card[]): {
  knownIDs: CardID[]
  unknownCards: Card[]
} {
  const knownIDs: CardID[] = []
  const unknownCards: Card[] = []
  cards.forEach((card) => {
    if (card.isKnown === true && card.id > 0) {
      knownIDs.push(card.id)
      return
    }
    unknownCards.push(card)
  })
  return { knownIDs, unknownCards }
}

/** 协议已声明的身份由通用明牌路径处理，余下实体限定为当前批次。 */
export function getExchangeSourceCards(cardIDs: readonly CardID[], cards: readonly Card[]): Card[] {
  const knownIDs = new Set(getPositiveIDs(cardIDs))
  return cards.filter((card) => !knownIDs.has(card.id))
}

export function clearExchangeBatches(room: Room, keys: Iterable<string | null>): void {
  for (const key of keys) {
    if (key !== null) room.publicZones.deleteExchangeBatch(key)
  }
}
