/**
 * 黄承彦【观虚】（SpellID=987/988）目标视角交换桶。
 *
 * 协议把牌堆顶与目标手牌都暂存在 exchange(10)，并用 FromID/ToID 区分两侧逻辑桶。
 * Room 的 exchange 是一个全局公共区，若不保留桶归属，区内已知牌移动会误取物理端点，
 * 最后的空 CardIDs 回牌堆也会漏掉已经换入牌堆侧的已知手牌。
 */
import { isAnonymous, type Card } from '../Card'
import { POSITION_TOP, insertCardsAtProtocolPosition } from '../candidate/cardPositions'
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

type ProtocolKnownCardCommit =
  | {
      type: 'confirm'
      card: Card
      cardID: number
    }
  | {
      type: 'materialize'
      cardID: number
      target: Card
    }

type ProtocolKnownCardResolution = {
  cards: Card[]
  commits: ProtocolKnownCardCommit[]
}

type KnownMoveSelection = {
  cards: Card[]
  knownResolution: ProtocolKnownCardResolution
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

/**
 * 只读解析协议明牌与候选实体的对应关系。
 *
 * 校验阶段只记录 confirm/materialize 计划；调用方确认整批张数与分桶都有效后才能提交，
 * 否则错误消息会把部分 CardID 提前固化到实体和身份账本。
 */
function resolveProtocolKnownCards(
  event: MoveEventDraft,
  room: Room,
  candidates: Card[]
): ProtocolKnownCardResolution {
  const selected: Card[] = []
  const selectedSet = new Set<Card>()
  const anonymousTargets = candidates.filter(isAnonymous)
  const plannedCardsByID = new Map<number, Card>()
  const commits: ProtocolKnownCardCommit[] = []

  getPositiveIDs(event.cardIDs ?? []).forEach((cardID) => {
    let card =
      candidates.find((candidate) => candidate.id === cardID) ??
      plannedCardsByID.get(cardID) ??
      null
    let commit: ProtocolKnownCardCommit | null = null

    if (!card) {
      const target = anonymousTargets.shift() ?? null
      const probedCard = room.probeMaterialize(cardID, target)
      if (probedCard && candidates.includes(probedCard)) {
        card = probedCard
        if (probedCard === target) {
          plannedCardsByID.set(cardID, probedCard)
          commit = { type: 'materialize', cardID, target: probedCard }
        } else {
          commit = { type: 'confirm', cardID, card: probedCard }
        }
      }
    } else {
      const isPlannedCard = plannedCardsByID.get(cardID) === card
      if (!isPlannedCard) commit = { type: 'confirm', cardID, card }
    }

    if (!card || selectedSet.has(card)) return
    selectedSet.add(card)
    selected.push(card)
    if (commit) commits.push(commit)
  })

  return { cards: selected, commits }
}

function commitProtocolKnownCards(room: Room, resolution: ProtocolKnownCardResolution): boolean {
  // 提交前统一复核物化目标，避免未来调用者在探测与提交之间改动 Room 后产生半提交。
  const canCommit = resolution.commits.every((commit) => {
    if (commit.type === 'confirm') return commit.card.id === commit.cardID
    return room.probeMaterialize(commit.cardID, commit.target) === commit.target
  })
  if (!canCommit) return false

  resolution.commits.forEach((commit) => {
    if (commit.type === 'confirm') {
      commit.card.confirmKnown()
      return
    }
    room.materialize(commit.cardID, commit.target)
  })
  return true
}

function selectCardsForKnownMove(
  event: MoveEventDraft,
  room: Room,
  candidates: Card[]
): KnownMoveSelection {
  const count = getCount(event)
  const protocolKnownCount = getPositiveIDs(event.cardIDs ?? []).length
  const knownResolution = resolveProtocolKnownCards(event, room, candidates)
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

function splitProtocolKnownAndUnknown(event: MoveEventDraft, cards: Card[]): Card[] {
  const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []))
  return cards.filter((card) => !protocolKnownIDs.has(card.id))
}

function stagePileToExchange(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const raw = getRaw(event)
  const count = getCount(event)
  const pileBucketID = Number(raw.ToID)
  const pileCards = room.zones.get('pile')?.cards ?? []
  // 逻辑桶复用公共 Zone 的底 -> 顶顺序，后续可直接套用通用 ToPosition 插槽语义。
  const selectedCards = pileCards.slice(-count)

  if (!(count > 0) || !Number.isFinite(pileBucketID) || selectedCards.length !== count) {
    clearBatch(room, spellID)
    return event
  }

  const knownResolution = resolveProtocolKnownCards(event, room, selectedCards)
  if (
    knownResolution.cards.length !== getPositiveIDs(event.cardIDs ?? []).length ||
    !commitProtocolKnownCards(room, knownResolution)
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

  const selection = selectCardsForKnownMove(event, room, getHandCards(room, fromSeat))
  if (
    selection.cards.length !== getCount(event) ||
    !commitProtocolKnownCards(room, selection.knownResolution)
  ) {
    clearBatch(room, spellID)
    return event
  }
  const selectedCards = selection.cards

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
  const selection = selectCardsForKnownMove(event, room, exchangeCards)
  if (
    selection.cards.length !== getCount(event) ||
    !commitProtocolKnownCards(room, selection.knownResolution)
  ) {
    return event
  }
  const selectedCards = selection.cards

  const selectedSet = new Set(selectedCards)
  sourceBucket.cards = sourceBucket.cards.filter((card) => !selectedSet.has(card))
  const targetIsPileBucket = Number(raw.ToID) === batch.pileBucketID
  const cardsToInsert = selectedCards.filter((card) => !targetBucket.cards.includes(card))
  const insertedAtExactPosition = targetIsPileBucket
    ? insertCardsAtProtocolPosition(targetBucket.cards, cardsToInsert, raw.ToPosition)
    : false
  if (!insertedAtExactPosition) {
    targetBucket.cards.push(...cardsToInsert)
  }

  if (Number(raw.FromID) === batch.pileBucketID) {
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

  // 牌堆逻辑桶与 Zone 都按底 -> 顶保存，空 CardIDs 回堆时可直接作为 sourceCards 使用。
  const cardsBottomFirst = bucket.cards.filter((card) => card.location === 'exchange')
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

  delete batch.buckets[bucketKey]
  clearBatchIfEmpty(room, spellID, batch)

  return patchEvent(event, {
    options: {
      position: POSITION_TOP,
      sourceCards: splitProtocolKnownAndUnknown(event, cardsBottomFirst),
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
