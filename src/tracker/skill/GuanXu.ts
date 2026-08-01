/**
 * 黄承彦【观虚】（SpellID=987/988）目标视角交换桶。
 *
 * 协议把牌堆顶与目标手牌都暂存在 exchange(10)，并用 FromID/ToID 区分两侧逻辑桶。
 * Room 的 exchange 是一个全局公共区，若不保留桶归属，区内已知牌移动会误取物理端点，
 * 最后的空 CardIDs 回牌堆也会漏掉已经换入牌堆侧的已知手牌。
 */
import { isAnonymous, type Card } from '../Card'
import { POSITION_TOP } from '../candidate/cardPositions'
import { createPublicCandidate } from '../candidate/publicCandidate'
import { MOVE_TYPE } from '../MoveEventNormalizer'
import type { Room } from '../Room'
import { getCount, getRaw } from './moveEventUtils'

export const GUAN_XU_STATE_KEY = 'guanXuExchange'

const GUAN_XU_SPELL_IDS = new Set([987, 988])

type MoveEventDraft = any

type GuanXuBucket = {
  cards: Card[]
  expectedCount: number
}

type GuanXuBatch = {
  buckets: Record<string, GuanXuBucket>
  pileRangeCards: Set<Card>
  pileBucketID: number
  spellID: number
}

type GuanXuRoomState = {
  bySpell: Record<string, GuanXuBatch>
}

function patchEvent(event: MoveEventDraft, patch: any = {}): MoveEventDraft {
  return {
    ...event,
    ...patch,
    cardIDs: patch.cardIDs ?? event.cardIDs,
    options: {
      ...event.options,
      ...(patch.options ?? {})
    }
  }
}

function getPositiveIDs(cardIDs: any[] = []): number[] {
  return cardIDs.map(Number).filter((cardID) => cardID > 0)
}

function getState(room: Room): GuanXuRoomState {
  return room.getSkillState(GUAN_XU_STATE_KEY, () => ({
    bySpell: {}
  })) as GuanXuRoomState
}

function getStateReadonly(room: Room): GuanXuRoomState | undefined {
  return room.skillState.get(GUAN_XU_STATE_KEY) as GuanXuRoomState | undefined
}

function getBatch(room: Room, spellID: number): GuanXuBatch | undefined {
  return getStateReadonly(room)?.bySpell[String(spellID)]
}

function clearBatch(room: Room, spellID: number): void {
  const state = getStateReadonly(room)
  if (!state) return

  delete state.bySpell[String(spellID)]
  if (Object.keys(state.bySpell).length === 0) {
    room.clearSkillState(GUAN_XU_STATE_KEY)
  }
}

function clearBatchIfEmpty(room: Room, spellID: number, batch: GuanXuBatch): void {
  if (Object.keys(batch.buckets).length === 0) clearBatch(room, spellID)
}

function getHandCards(room: Room, seatID: number): Card[] {
  return room
    .refreshPlayerSnapshot()
    .filter((card) => card.subZone === 'hand' && card.seats.has(seatID))
}

function resolveProtocolKnownCards(event: MoveEventDraft, room: Room, candidates: Card[]): Card[] {
  const selected: Card[] = []
  const selectedSet = new Set<Card>()
  const anonymousTargets = candidates.filter(isAnonymous)

  getPositiveIDs(event.cardIDs ?? []).forEach((cardID) => {
    let card = candidates.find((candidate) => candidate.id === cardID) ?? null

    if (!card) {
      const target = anonymousTargets.shift() ?? null
      const materialized = room.materialize(cardID, target)
      if (materialized && candidates.includes(materialized)) card = materialized
    } else {
      card.confirmKnown()
    }

    if (!card || selectedSet.has(card)) return
    selectedSet.add(card)
    selected.push(card)
  })

  return selected
}

function selectCardsForKnownMove(event: MoveEventDraft, room: Room, candidates: Card[]): Card[] {
  const count = getCount(event)
  const protocolKnownCount = getPositiveIDs(event.cardIDs ?? []).length
  const selected = resolveProtocolKnownCards(event, room, candidates)
  if (selected.length !== protocolKnownCount) return []

  const selectedSet = new Set(selected)

  candidates.forEach((card) => {
    if (selected.length >= count || selectedSet.has(card) || card.isKnown === true) return
    selectedSet.add(card)
    selected.push(card)
  })

  return selected.slice(0, count)
}

function splitProtocolKnownAndUnknown(event: MoveEventDraft, cards: Card[]): Card[] {
  const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []))
  return cards.filter((card) => !protocolKnownIDs.has(card.id))
}

function stagePileToExchange(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const raw = getRaw(event)
  const count = getCount(event)
  const pileBucketID = Number(raw.ToID)
  const pileCards = room.zones.get('pile')?.cards ?? []
  const selectedCards = pileCards.slice(-count).reverse()

  if (!(count > 0) || !Number.isFinite(pileBucketID) || selectedCards.length !== count) {
    clearBatch(room, spellID)
    return event
  }

  if (
    resolveProtocolKnownCards(event, room, selectedCards).length !==
    getPositiveIDs(event.cardIDs ?? []).length
  ) {
    clearBatch(room, spellID)
    return event
  }

  getState(room).bySpell[String(spellID)] = {
    buckets: {
      [String(pileBucketID)]: {
        cards: selectedCards,
        expectedCount: count
      }
    },
    pileRangeCards: new Set(),
    pileBucketID,
    spellID
  }

  return patchEvent(event, {
    options: {
      fromPosition: POSITION_TOP,
      sourceCards: splitProtocolKnownAndUnknown(event, selectedCards)
    }
  })
}

function stageHandToExchange(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const raw = getRaw(event)
  const batch = getBatch(room, spellID)
  const fromSeat = Number(raw.FromID)
  const bucketID = Number(raw.ToID)
  if (!batch || !Number.isFinite(fromSeat) || !Number.isFinite(bucketID)) return event

  const selectedCards = selectCardsForKnownMove(event, room, getHandCards(room, fromSeat))
  if (selectedCards.length !== getCount(event)) {
    clearBatch(room, spellID)
    return event
  }

  batch.buckets[String(bucketID)] = {
    cards: selectedCards,
    expectedCount: getCount(event)
  }

  const sourceCards = splitProtocolKnownAndUnknown(event, selectedCards)
  return patchEvent(event, {
    options: {
      ...(sourceCards.length > 0 ? { sourceCards } : {})
    }
  })
}

function transferExchangeBucket(
  event: MoveEventDraft,
  room: Room,
  spellID: number
): MoveEventDraft {
  const raw = getRaw(event)
  const batch = getBatch(room, spellID)
  const fromKey = String(raw.FromID)
  const toKey = String(raw.ToID)
  const sourceBucket = batch?.buckets[fromKey]
  const targetBucket = batch?.buckets[toKey]
  if (!batch || !sourceBucket || !targetBucket || fromKey === toKey) return event

  const exchangeCards = sourceBucket.cards.filter((card) => card.location === 'exchange')
  const selectedCards = selectCardsForKnownMove(event, room, exchangeCards)
  if (selectedCards.length !== getCount(event)) return event

  const selectedSet = new Set(selectedCards)
  sourceBucket.cards = sourceBucket.cards.filter((card) => !selectedSet.has(card))
  selectedCards.forEach((card) => {
    if (!targetBucket.cards.includes(card)) targetBucket.cards.push(card)
  })

  if (Number(raw.FromID) === batch.pileBucketID) {
    selectedCards.forEach((card) => batch.pileRangeCards.delete(card))
  }
  if (Number(raw.ToID) === batch.pileBucketID) {
    selectedCards.forEach((card) => batch.pileRangeCards.add(card))
  }

  const sourceCards = splitProtocolKnownAndUnknown(event, selectedCards)
  return patchEvent(event, {
    options: {
      ...(sourceCards.length > 0 ? { sourceCards } : {})
    }
  })
}

function returnBucketToPile(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const raw = getRaw(event)
  const batch = getBatch(room, spellID)
  const bucketKey = String(raw.FromID)
  const bucket = batch?.buckets[bucketKey]
  if (!batch || !bucket || Number(raw.FromID) !== batch.pileBucketID) return event

  const cards = bucket.cards.filter((card) => card.location === 'exchange')
  if (cards.length !== getCount(event) || cards.length !== bucket.expectedCount) return event

  const pileCandidate = createPublicCandidate('pile', POSITION_TOP, bucket.expectedCount)
  const postMovePublicCandidates = cards
    .filter((card) => batch.pileRangeCards.has(card) && card.id > 0 && card.isKnown === true)
    .map((card) => ({ card, candidate: pileCandidate }))

  delete batch.buckets[bucketKey]
  clearBatchIfEmpty(room, spellID, batch)

  return patchEvent(event, {
    options: {
      position: POSITION_TOP,
      sourceCards: splitProtocolKnownAndUnknown(event, cards),
      ...(postMovePublicCandidates.length > 0 ? { postMovePublicCandidates } : {})
    }
  })
}

function returnBucketToHand(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const raw = getRaw(event)
  const batch = getBatch(room, spellID)
  const bucketKey = String(raw.FromID)
  const bucket = batch?.buckets[bucketKey]
  if (!batch || !bucket) return event

  const cards = bucket.cards.filter((card) => card.location === 'exchange')
  if (cards.length !== getCount(event) || cards.length !== bucket.expectedCount) return event

  const knownIDs = Array.from(
    new Set([
      ...getPositiveIDs(event.cardIDs ?? []),
      ...cards.filter((card) => card.isKnown === true && card.id > 0).map((card) => card.id)
    ])
  )
  const knownIDSet = new Set(knownIDs)
  const sourceCards = cards.filter((card) => !knownIDSet.has(card.id))

  delete batch.buckets[bucketKey]
  clearBatchIfEmpty(room, spellID, batch)

  return patchEvent(event, {
    cardIDs: knownIDs,
    options: {
      ...(sourceCards.length > 0 ? { sourceCards } : {})
    }
  })
}

export function isGuanXuSpellID(spellID: number): boolean {
  return GUAN_XU_SPELL_IDS.has(Number(spellID))
}

export default function decorateGuanXu(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  const spellID = Number(raw.SpellID ?? event.options?.spellID)
  if (!isGuanXuSpellID(spellID)) return event
  if (Number(raw.MoveType ?? event.moveType ?? event.options?.moveType) !== MOVE_TYPE.EXCHANGE) {
    return event
  }

  const fromZone = Number(raw.FromZone)
  const toZone = Number(raw.ToZone)

  if (fromZone === 1 && toZone === 10) return stagePileToExchange(event, room, spellID)
  if (fromZone === 5 && toZone === 10) return stageHandToExchange(event, room, spellID)
  if (fromZone === 10 && toZone === 10) return transferExchangeBucket(event, room, spellID)
  if (fromZone === 10 && toZone === 1) return returnBucketToPile(event, room, spellID)
  if (fromZone === 10 && toZone === 5) return returnBucketToHand(event, room, spellID)

  return event
}
