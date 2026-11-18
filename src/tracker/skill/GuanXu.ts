/**
 * 黄承彦【观虚】（SpellID=987/988）目标视角交换桶。
 *
 * 协议把牌堆顶与目标手牌都暂存在 exchange(10)，并用 FromID/ToID 区分两侧逻辑桶。
 * Room 的 exchange 是一个全局公共区，若不保留桶归属，区内已知牌移动会误取物理端点，
 * 最后的空 CardIDs 回牌堆也会漏掉已经换入牌堆侧的已知手牌。
 */
import type { Card } from '@/tracker/model/Card'
import { POSITION_TOP, POSITION_RANDOM } from '../candidate/cardPositions'
import { createPublicCandidate } from '../candidate/publicCandidate'
import { MOVE_TYPE } from '../protocol/MoveEventNormalizer'
import type { Room } from '../Room'
import { getPositiveIDs } from '../helper/cardIDs'
import { getCount, type MoveEventDraft, patchEvent } from './moveEventUtils'
import { defineSkillState, deleteSpellState } from './skillState'
import {
  clearExchangeBatches,
  commitExchangeKnownCards,
  getExchangeSourceCards,
  planExchangeKnownCards,
  type ExchangeKnownCardPlan
} from './exchangeCards'

export const GUAN_XU_STATE_KEY = 'guanXuExchange'

const GUAN_XU_SPELL_IDS = new Set([987, 988])

type GuanXuBucket = {
  batchKey: string
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

type KnownMoveSelection = {
  cards: Card[]
  knownResolution: ExchangeKnownCardPlan
}

const guanXuState = defineSkillState<GuanXuRoomState>(GUAN_XU_STATE_KEY)

function getBatch(room: Room, spellID: number): GuanXuBatch | undefined {
  return guanXuState.read(room)?.bySpell[String(spellID)]
}

function clearBatch(room: Room, spellID: number): void {
  const state = guanXuState.read(room)
  if (!state) return

  clearExchangeBatches(
    room,
    Object.values(state.bySpell[String(spellID)]?.buckets ?? {}).map((bucket) => bucket.batchKey)
  )
  deleteSpellState(room, GUAN_XU_STATE_KEY, spellID)
}

function clearBatchIfEmpty(room: Room, spellID: number, batch: GuanXuBatch): void {
  if (Object.keys(batch.buckets).length === 0) clearBatch(room, spellID)
}

function getHandCards(room: Room, seatID: number): Card[] {
  return room
    .refreshPlayerSnapshot()
    .filter((card) => card.subZone === 'hand' && card.seats.has(seatID))
}

function selectCardsForKnownMove(
  event: MoveEventDraft,
  room: Room,
  candidates: Card[]
): KnownMoveSelection {
  const count = getCount(event)
  const protocolKnownCount = getPositiveIDs(event.cardIDs ?? []).length
  const knownResolution = planExchangeKnownCards(room, event.cardIDs, candidates)
  const selected = [...knownResolution.cards]
  if (selected.length !== protocolKnownCount) return { cards: [], knownResolution }

  const selectedSet = new Set(selected)

  candidates.forEach((card) => {
    if (selected.length >= count || selectedSet.has(card) || card.isKnown === true) return
    selectedSet.add(card)
    selected.push(card)
  })

  return {
    cards: selected.slice(0, count),
    knownResolution
  }
}

function stagePileToExchange(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const move = event.protocol
  const count = getCount(event)
  const pileBucketID = move.ToID
  const pileCards = room.getZone('pile').cards
  // 逻辑桶复用公共 Zone 的底 -> 顶顺序，后续可直接套用通用 ToPosition 插槽语义。
  const selectedCards = pileCards.slice(-count)

  if (!(count > 0) || !Number.isFinite(pileBucketID) || selectedCards.length !== count) {
    clearBatch(room, spellID)
    return event
  }

  const knownResolution = planExchangeKnownCards(room, event.cardIDs, selectedCards)
  if (
    knownResolution.cards.length !== getPositiveIDs(event.cardIDs).length ||
    !commitExchangeKnownCards(room, knownResolution)
  ) {
    clearBatch(room, spellID)
    return event
  }

  clearBatch(room, spellID)
  const batchKey = `${spellID}:pile:${pileBucketID}`
  room.publicZones.getExchangeBatch(batchKey).stage(selectedCards)
  guanXuState.ensure(room, () => ({ bySpell: {} })).bySpell[String(spellID)] = {
    buckets: {
      [String(pileBucketID)]: {
        batchKey,
        expectedCount: count
      }
    },
    pileRangeCards: new Set(),
    pileBucketID,
    spellID
  }

  return patchEvent(event, {
    from: event.from.type === 'public' ? { ...event.from, position: POSITION_TOP } : event.from,
    options: { sourceCards: getExchangeSourceCards(event.cardIDs, selectedCards) }
  })
}

function stageHandToExchange(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const move = event.protocol
  const batch = getBatch(room, spellID)
  const fromSeat = move.FromID
  const bucketID = move.ToID
  if (!batch || !Number.isFinite(fromSeat) || !Number.isFinite(bucketID)) return event

  const selection = selectCardsForKnownMove(event, room, getHandCards(room, fromSeat))
  if (
    selection.cards.length !== getCount(event) ||
    !commitExchangeKnownCards(room, selection.knownResolution)
  ) {
    clearBatch(room, spellID)
    return event
  }
  const selectedCards = selection.cards

  const batchKey = `${spellID}:seat:${bucketID}`
  room.publicZones.getExchangeBatch(batchKey).stage(selectedCards)
  batch.buckets[String(bucketID)] = {
    batchKey,
    expectedCount: getCount(event)
  }

  const sourceCards = getExchangeSourceCards(event.cardIDs, selectedCards)
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
  const move = event.protocol
  const batch = getBatch(room, spellID)
  const fromKey = String(move.FromID)
  const toKey = String(move.ToID)
  const sourceBucket = batch?.buckets[fromKey]
  const targetBucket = batch?.buckets[toKey]
  if (!batch || !sourceBucket || !targetBucket || fromKey === toKey) return event

  const sourceBatch = room.publicZones.getExchangeBatch(sourceBucket.batchKey)
  const targetBatch = room.publicZones.getExchangeBatch(targetBucket.batchKey)
  const exchangeCards = sourceBatch.cards
  const selection = selectCardsForKnownMove(event, room, exchangeCards)
  if (
    selection.cards.length !== getCount(event) ||
    !commitExchangeKnownCards(room, selection.knownResolution)
  ) {
    return event
  }
  const selectedCards = selection.cards

  const targetIsPileBucket = move.ToID === batch.pileBucketID
  // 目标桶按存活实体过滤后再计算 ToPosition/插入，保证桶索引与 returnBucketToPile 的
  // exchange 存活集合一致，避免残留实体让协议插槽算错落点。
  const insertedAtExactPosition = sourceBatch.transferTo(
    targetBatch,
    selectedCards,
    targetIsPileBucket ? move.ToPosition : POSITION_RANDOM
  )

  if (move.FromID === batch.pileBucketID) {
    selectedCards.forEach((card) => batch.pileRangeCards.delete(card))
  }
  if (targetIsPileBucket) {
    selectedCards.forEach((card) => {
      if (insertedAtExactPosition) {
        batch.pileRangeCards.delete(card)
        return
      }
      batch.pileRangeCards.add(card)
    })
  }

  const sourceCards = getExchangeSourceCards(event.cardIDs, selectedCards)
  return patchEvent(event, {
    options: {
      ...(sourceCards.length > 0 ? { sourceCards } : {})
    }
  })
}

function returnBucketToPile(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const move = event.protocol
  const batch = getBatch(room, spellID)
  const bucketKey = String(move.FromID)
  const bucket = batch?.buckets[bucketKey]
  if (!batch || !bucket || move.FromID !== batch.pileBucketID) return event

  // 牌堆逻辑桶与 Zone 都按底 -> 顶保存，空 CardIDs 回堆时可直接作为 sourceCards 使用。
  const cardsBottomFirst = room.publicZones.getExchangeBatch(bucket.batchKey).cards
  if (
    cardsBottomFirst.length !== getCount(event) ||
    cardsBottomFirst.length !== bucket.expectedCount
  ) {
    return event
  }

  const protocolKnownIDs = getPositiveIDs(event.cardIDs ?? [])
  const protocolKnownIDSet = new Set(protocolKnownIDs)
  const hasCompletePileOrder =
    protocolKnownIDs.length === cardsBottomFirst.length &&
    protocolKnownIDSet.size === cardsBottomFirst.length &&
    cardsBottomFirst.every((card) => protocolKnownIDSet.has(card.id))
  const pileCandidate = createPublicCandidate('pile', POSITION_TOP, bucket.expectedCount)
  // 主视角的完整 CardIDs 已给出整批回堆顺序；范围候选只用于看不到完整列表的其它视角，
  // 否则较弱的“牌顶前 N 张”会在移动后覆盖 handleRoleOptTargetNtf 建立的精确牌顶。
  const postMovePublicCandidates = hasCompletePileOrder
    ? []
    : cardsBottomFirst
        .filter((card) => batch.pileRangeCards.has(card) && card.id > 0 && card.isKnown === true)
        .map((card) => ({ card, candidate: pileCandidate }))

  room.publicZones.deleteExchangeBatch(bucket.batchKey)
  delete batch.buckets[bucketKey]
  clearBatchIfEmpty(room, spellID, batch)

  return patchEvent(event, {
    to: event.to.type === 'public' ? { ...event.to, position: POSITION_TOP } : event.to,
    options: {
      sourceCards: getExchangeSourceCards(event.cardIDs, cardsBottomFirst),
      ...(postMovePublicCandidates.length > 0 ? { postMovePublicCandidates } : {})
    }
  })
}

function returnBucketToHand(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const move = event.protocol
  const batch = getBatch(room, spellID)
  const bucketKey = String(move.FromID)
  const bucket = batch?.buckets[bucketKey]
  // 牌堆逻辑桶只能整批回堆；异常协议若把牌堆桶回写玩家手牌，对称拒绝以免污染手牌区。
  if (!batch || !bucket || move.FromID === batch.pileBucketID) return event

  const cards = room.publicZones.getExchangeBatch(bucket.batchKey).cards
  if (cards.length !== getCount(event) || cards.length !== bucket.expectedCount) return event

  // 保留协议原始 cardIDs，本地推断来源只经 options.sourceCards 传递，不回写明牌列表。
  const knownIDSet = new Set([
    ...getPositiveIDs(event.cardIDs ?? []),
    ...cards.filter((card) => card.isKnown === true && card.id > 0).map((card) => card.id)
  ])
  const sourceCards = cards.filter((card) => !knownIDSet.has(card.id))

  room.publicZones.deleteExchangeBatch(bucket.batchKey)
  delete batch.buckets[bucketKey]
  clearBatchIfEmpty(room, spellID, batch)

  return patchEvent(event, {
    options: {
      ...(sourceCards.length > 0 ? { sourceCards } : {})
    }
  })
}

export function isGuanXuSpellID(spellID: number): boolean {
  return GUAN_XU_SPELL_IDS.has(spellID)
}

export default function decorateGuanXu(event: MoveEventDraft, room: Room): MoveEventDraft {
  const move = event.protocol
  const spellID = move.SpellID
  if (!isGuanXuSpellID(spellID)) return event
  if (event.moveType !== MOVE_TYPE.EXCHANGE) {
    return event
  }

  const fromZone = move.FromZone
  const toZone = move.ToZone

  if (fromZone === 1 && toZone === 10) return stagePileToExchange(event, room, spellID)
  if (fromZone === 5 && toZone === 10) return stageHandToExchange(event, room, spellID)
  if (fromZone === 10 && toZone === 10) return transferExchangeBucket(event, room, spellID)
  if (fromZone === 10 && toZone === 1) return returnBucketToPile(event, room, spellID)
  if (fromZone === 10 && toZone === 5) return returnBucketToHand(event, room, spellID)

  return event
}
