/**
 * 周群【天候】（SpellID=3903）其他视角交换候选。
 *
 * 发动者能看到完整 CardIDs，继续走默认精确移动。其他视角的交换消息 CardIDs 全空，
 * 只能确认“从三张牌顶中换入 x 张，并将 x 张原手牌置于牌堆顶”。本装饰器用批次引用
 * 区分交换区里的两组匿名实体，并为原手牌明牌保留手牌/牌堆顶候选。
 *
 * 匿名交换固定依次经过 pile -> exchange、hand -> exchange、两次 exchange -> exchange、
 * exchange -> hand、exchange -> pile。最后的单牌展示只证明牌位于结算后的牌顶三张中，
 * 不提供它在三张中的具体序号。
 */
import { trackerLogger } from '@/utils/logger'
import type { Card } from '@/tracker/model/Card'
import type { SlotCountRange } from '../constraint/ConstraintGroup'
import { POSITION_RANDOM, POSITION_TOP } from '../candidate/cardPositions'
import { createLocationCandidateKey } from '../candidate/locationCandidate'
import { createPublicCandidate } from '../candidate/publicCandidate'
import { isPileSingleCardShow, MOVE_TYPE } from '../protocol/MoveEventNormalizer'
import type { Room } from '../Room'
import { recordTraversal } from '../traversalStats'
import type { PlayerLocationCandidate, SeatID } from '../types'
import { getCount, hasPositiveID, type MoveEventDraft, patchEvent } from './moveEventUtils'

export const TIAN_HOU_SPELL_ID = 3903
export const TIAN_HOU_STATE_KEY = 'tianHouExchange'

const TIAN_HOU_VIEW_COUNT = 3

type TianHouPhase = 'pile-staged' | 'hand-staged' | 'hand-returned' | 'awaiting-reveal'

type TianHouBatch = {
  actorSeat: SeatID
  /** 本轮交换张数 x，同时也是换出手牌落在牌堆顶的范围大小。 */
  count: number
  /** 从牌堆暂存到交换区、随后进入手牌的实体引用。 */
  pileBatchKey: string
  /** 代表换出手牌、实际经过交换区并回到牌堆的实体引用。 */
  handBatchKey: string
  /** 交换前可确定身份的手牌；它们是否被换出只能用候选表达。 */
  knownHandCards: Card[]
  /** 已知手牌中被换出张数的可证明上下界。 */
  minKnownOut: number
  maxKnownOut: number
  phase: TianHouPhase
}

type TianHouRoomState = {
  batch: TianHouBatch | null
}

function getTianHouState(room: Room): TianHouRoomState | null {
  return room.readSkillState<TianHouRoomState>(TIAN_HOU_STATE_KEY) ?? null
}

function ensureTianHouState(room: Room): TianHouRoomState {
  return room.ensureSkillState(TIAN_HOU_STATE_KEY, () => ({ batch: null }))
}

function clearBatch(room: Room, cleanupTemporaryCandidates = false): void {
  const state = getTianHouState(room)
  const batch = state?.batch
  if (batch) {
    room.publicZones.deleteExchangeBatch(batch.pileBatchKey)
    room.publicZones.deleteExchangeBatch(batch.handBatchKey)
  }
  // 中途失配时撤销尚在交换区的临时候选；结算后的牌堆候选必须继续保留。
  if (cleanupTemporaryCandidates && batch && batch.phase !== 'awaiting-reveal') {
    batch.knownHandCards.forEach((card) => {
      card.removePublicCandidates((candidate) => candidate?.zone === 'exchange')
    })
  }

  room.deleteSkillState(TIAN_HOU_STATE_KEY)
}

function isOtherView(room: Room, actorSeat: SeatID): boolean {
  return room.mySeatID === undefined || room.mySeatID !== actorSeat
}

function getActorHandCards(room: Room, actorSeat: SeatID): Card[] {
  const playerCards = room.refreshPlayerSnapshot()
  recordTraversal('tianHou:playerHand', playerCards.length)
  // 已带位置歧义的牌不能再次纳入本轮手牌基数，否则会叠加两套互不相关的候选。
  return playerCards.filter(
    (card) =>
      card.location === 'player' &&
      card.subZone === 'hand' &&
      card.seats.size === 1 &&
      card.seats.has(actorSeat) &&
      !card.hasLocationCandidates?.() &&
      !card.hasSubZoneCandidates?.()
  )
}

function createKnownOutConstraint(
  room: Room,
  batch: TianHouBatch,
  cards: Card[],
  knownOut: SlotCountRange,
  label: string
): string | null {
  if (cards.length === 0) return null

  const handCandidate: PlayerLocationCandidate = {
    type: 'player',
    seatID: batch.actorSeat,
    subZone: 'hand',
    spellID: null
  }
  const pileCandidate = {
    type: 'public' as const,
    ...createPublicCandidate('pile', POSITION_TOP, batch.count)
  }
  const groupID = `tianhou_${label}_${++room.constraintGroupSeq}`

  room.createConstraintGroup({
    id: groupID,
    cards,
    expectedSlotsByLocation: new Map([
      [
        createLocationCandidateKey(handCandidate),
        {
          min: cards.length - knownOut.max,
          max: cards.length - knownOut.min
        }
      ],
      [createLocationCandidateKey(pileCandidate), knownOut]
    ]),
    known: true,
    sourceEvent: {
      type: `tianHou:${label}`,
      raw: {
        actorSeat: batch.actorSeat,
        count: batch.count,
        knownOut
      }
    }
  })

  return groupID
}

function decoratePileStage(event: MoveEventDraft, room: Room, actorSeat: SeatID): MoveEventDraft {
  const count = getCount(event)
  if (!(count > 0) || count > TIAN_HOU_VIEW_COUNT || !isOtherView(room, actorSeat)) return event

  const pileCards = room.zones.get('pile')?.cards ?? []
  // CardIDs 为空时，这些引用负责让 x 张牌在交换区往返，不能据此公开其牌面。
  const selectedPileCards = pileCards.slice(-count).reverse()
  if (selectedPileCards.length !== count) return event

  clearBatch(room, true)
  const pileBatchKey = `${TIAN_HOU_SPELL_ID}:pile:${actorSeat}`
  const handBatchKey = `${TIAN_HOU_SPELL_ID}:seat:${actorSeat}`
  room.publicZones.getExchangeBatch(pileBatchKey).stage(selectedPileCards)
  ensureTianHouState(room).batch = {
    actorSeat,
    count,
    pileBatchKey,
    handBatchKey,
    knownHandCards: [],
    minKnownOut: 0,
    maxKnownOut: 0,
    phase: 'pile-staged'
  }

  return patchEvent(event, {
    options: {
      sourceCards: selectedPileCards
    }
  })
}

function decorateHandStage(event: MoveEventDraft, room: Room, actorSeat: SeatID): MoveEventDraft {
  const state = getTianHouState(room)
  const batch = state?.batch
  const count = getCount(event)
  if (
    !batch ||
    batch.phase !== 'pile-staged' ||
    batch.actorSeat !== actorSeat ||
    batch.count !== count
  ) {
    clearBatch(room, true)
    return event
  }

  const player = room.getPlayer(actorSeat)
  const handCards = getActorHandCards(room, actorSeat)
  const knownHandCards = handCards.filter((card) => card.isKnown === true)
  const hiddenHandCards = handCards.filter((card) => card.isKnown !== true)
  // 匿名手牌实体优先承担实际移动；实体不足时补场外占位，避免误搬某张已知手牌。
  const fallbackCards = room.createExternalCards([], Math.max(0, count - hiddenHandCards.length))
  const outgoingCards = [...hiddenHandCards.slice(0, count), ...fallbackCards].slice(0, count)
  const handCount =
    player?.hasObservedHandCount === true ? player.observedHandCount : handCards.length
  const hiddenCapacity = Math.max(0, handCount - knownHandCards.length)
  const exchangeCandidate = createPublicCandidate('exchange', POSITION_RANDOM, count)

  knownHandCards.forEach((card) => card.addPublicCandidate(exchangeCandidate))

  room.publicZones.getExchangeBatch(batch.handBatchKey).stage(outgoingCards)
  batch.knownHandCards = knownHandCards
  // 仅观测到 N 张手牌时才能用 N-K 估计暗牌容量；未观测时不能据实体数强制明牌换出。
  batch.maxKnownOut = Math.min(count, knownHandCards.length)
  batch.minKnownOut =
    player?.hasObservedHandCount === true
      ? Math.min(Math.max(0, count - hiddenCapacity), batch.maxKnownOut)
      : 0
  batch.phase = 'hand-staged'

  trackerLogger.info('天候记录其他视角换牌候选', {
    actorSeat,
    count,
    knownHandCardIDs: knownHandCards.map((card) => card.id),
    minKnownOut: batch.minKnownOut,
    maxKnownOut: batch.maxKnownOut
  })

  return patchEvent(event, {
    options: {
      sourceCards: outgoingCards
    }
  })
}

function decorateExchangeReorder(
  event: MoveEventDraft,
  room: Room,
  actorSeat: SeatID
): MoveEventDraft {
  const batch = getTianHouState(room)?.batch
  if (
    !batch ||
    batch.phase !== 'hand-staged' ||
    batch.actorSeat !== actorSeat ||
    batch.count !== getCount(event)
  ) {
    return event
  }

  // 两条 10 -> 10 只驱动客户端交换动画，CardIDs 为空时不提供任何实体顺序信息。
  return patchEvent(event, { type: 'noop' })
}

function decorateReturnToHand(
  event: MoveEventDraft,
  room: Room,
  actorSeat: SeatID
): MoveEventDraft {
  const batch = getTianHouState(room)?.batch
  if (
    !batch ||
    batch.phase !== 'hand-staged' ||
    batch.actorSeat !== actorSeat ||
    batch.count !== getCount(event)
  ) {
    return event
  }

  const selectedPileCards = room.publicZones.getExchangeBatch(batch.pileBatchKey).cards
  if (selectedPileCards.length !== batch.count) {
    clearBatch(room, true)
    return event
  }

  const knownIDs = selectedPileCards
    .filter((card) => card.isKnown === true && card.id > 0)
    .map((card) => card.id)
  // 明确身份走 cardIDs，匿名实体走 sourceCards，二者合计仍为本轮交换张数。
  const sourceCards = selectedPileCards.filter((card) => !knownIDs.includes(card.id))
  batch.phase = 'hand-returned'

  return patchEvent(event, {
    cardIDs: knownIDs,
    options: {
      sourceCards
    }
  })
}

function decorateReturnToPile(
  event: MoveEventDraft,
  room: Room,
  actorSeat: SeatID
): MoveEventDraft {
  const batch = getTianHouState(room)?.batch
  if (
    !batch ||
    batch.phase !== 'hand-returned' ||
    batch.actorSeat !== actorSeat ||
    batch.count !== getCount(event)
  ) {
    return event
  }

  const outgoingCards = room.publicZones.getExchangeBatch(batch.handBatchKey).cards
  if (outgoingCards.length !== batch.count) {
    clearBatch(room, true)
    return event
  }

  const pileCandidate = createPublicCandidate('pile', POSITION_TOP, batch.count)
  // 先把临时的 exchange 候选升级为结算位置：未换出仍在手牌，换出则位于牌顶前 x 张。
  batch.knownHandCards.forEach((card) => {
    card.removePublicCandidates((candidate) => candidate?.zone === 'exchange')
    card.addPublicCandidate(pileCandidate)
  })

  createKnownOutConstraint(
    room,
    batch,
    batch.knownHandCards,
    { min: batch.minKnownOut, max: batch.maxKnownOut },
    'exchange'
  )
  batch.phase = 'awaiting-reveal'

  return patchEvent(event, {
    cardIDs: [],
    options: {
      sourceCards: outgoingCards
    }
  })
}

function isKnownExactPileTopThree(room: Room, cardID: number): boolean {
  const card = room.cardIndex.get(cardID)
  if (!card || card.isKnown !== true || card.hasLocationCandidates?.()) return false
  return room.getPublicEndpointCards('pile', TIAN_HOU_VIEW_COUNT, POSITION_TOP).includes(card)
}

function decorateFinalReveal(event: MoveEventDraft, room: Room): MoveEventDraft {
  const cardID = event.cardIDs[0]
  if (!(cardID > 0)) return event

  const state = getTianHouState(room)
  const batch = state?.batch?.phase === 'awaiting-reveal' ? state.batch : null
  // 没有可配对批次且身份已精确位于牌顶三张时，保留更强的既有位置事实。
  if (!batch && isKnownExactPileTopThree(room, cardID)) return event

  const matchedCard = batch?.knownHandCards.find((card) => card.id === cardID) ?? null
  // 命中原手牌可证明它属于换出的 x 张；未命中时只能采用协议公开的牌顶三张范围。
  const candidateCount = matchedCard && batch ? batch.count : TIAN_HOU_VIEW_COUNT

  clearBatch(room)

  return patchEvent(event, {
    type: 'revealPublicCandidate',
    options: {
      publicCandidateReveal: {
        zone: 'pile',
        position: POSITION_TOP,
        count: candidateCount
      }
    }
  })
}

export default function decorateTianHou(event: MoveEventDraft, room: Room): MoveEventDraft {
  const move = event.protocol
  if (move.SpellID !== TIAN_HOU_SPELL_ID) return event
  if (isPileSingleCardShow(move)) return decorateFinalReveal(event, room)
  if (event.moveType !== MOVE_TYPE.EXCHANGE) {
    return event
  }

  // 主视角 CardIDs 明确，默认移动即可精确追踪；候选分支只接管其他视角的全暗协议。
  if (hasPositiveID(event.cardIDs ?? [])) return event

  const fromZone = move.FromZone
  const toZone = move.ToZone

  if (fromZone === 1 && toZone === 10) {
    return decoratePileStage(event, room, move.ToID)
  }
  if (fromZone === 5 && toZone === 10) {
    return decorateHandStage(event, room, move.FromID)
  }
  if (fromZone === 10 && toZone === 10) {
    return decorateExchangeReorder(event, room, move.FromID)
  }
  if (fromZone === 10 && toZone === 5) {
    return decorateReturnToHand(event, room, move.ToID)
  }
  if (fromZone === 10 && toZone === 1) {
    return decorateReturnToPile(event, room, move.FromID)
  }

  return event
}
