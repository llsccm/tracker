import { MOVE_TYPE } from '../MoveEventNormalizer'
import type { Card } from '../Card'
import type { Room } from '../Room'
import type { SeatID } from '../types'

/** 兼容旧导出名；整手交换已不再绑定单一技能 ID。 */
export const HAND_EXCHANGE_SPELL_ID = 121

/** 房间级账本：按 SpellID 隔离不同技能的交换批次。 */
export const HAND_EXCHANGE_STATE_KEY = 'handExchangeBatches'

type MoveEventDraft = any

type HandExchangeBatch = {
  cards: Card[]
  cardCount: number
  fromSeat: SeatID
  spellID: number
}

type HandExchangeSpellState = {
  batches: Record<string, HandExchangeBatch>
}

type HandExchangeRoomState = {
  bySpell: Record<string, HandExchangeSpellState>
}

function getRaw(event: MoveEventDraft): any {
  return event.raw ?? event.options?.sourceEvent?.raw ?? {}
}

function getCount(event: MoveEventDraft): number {
  return Math.max(0, Number(event.cardCount ?? event.options?.cardCount ?? 0))
}

function getPositiveIDs(cardIDs: any[] = []): number[] {
  return Array.from(new Set(cardIDs.map((id) => Number(id) || 0).filter((id) => id > 0)))
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

function nextGroupID(room: Room, spellID: number | string, label: string): string {
  return `${label}_${spellID}_${++room.constraintGroupSeq}`
}

function resolveSpellID(event: MoveEventDraft): number {
  const raw = getRaw(event)
  const spellID = Number(raw.SpellID ?? event.options?.spellID ?? 0)
  return Number.isFinite(spellID) ? spellID : 0
}

function getRoomExchangeState(room: Room): HandExchangeRoomState {
  return room.getSkillState(HAND_EXCHANGE_STATE_KEY, () => ({
    bySpell: {}
  })) as HandExchangeRoomState
}

function getSpellExchangeState(room: Room, spellID: number): HandExchangeSpellState {
  const roomState = getRoomExchangeState(room)
  const key = String(spellID)
  if (!roomState.bySpell[key]) {
    roomState.bySpell[key] = { batches: {} }
  }
  return roomState.bySpell[key]
}

function clearSpellExchangeState(room: Room, spellID: number): void {
  const roomState = getRoomExchangeState(room)
  delete roomState.bySpell[String(spellID)]
  if (Object.keys(roomState.bySpell).length === 0) {
    room.clearSkillState(HAND_EXCHANGE_STATE_KEY)
  }
}

function getPlayerHandCards(room: Room, seatID: SeatID): Card[] {
  return room.cards.filter(
    (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(seatID)
  )
}

/**
 * 只接管“整手经交换区互易”：
 * - MoveType=11
 * - CardCount 等于观测手牌数，或等于本地手牌实体数
 * - 允许协议带正 CardIDs（常见于己方整手）
 * 避免误伤佐练单张 5->10、诫厉暂存后回牌堆等路径。
 */
function isWholeHandExchangeStage(event: MoveEventDraft, room: Room, fromSeat: SeatID): boolean {
  const handCards = getPlayerHandCards(room, fromSeat)
  if (handCards.length === 0) return false

  const cardCount = getCount(event)
  if (!(cardCount > 0)) return false

  if (cardCount === handCards.length) return true

  const player = room.getPlayer(fromSeat)
  return player?.hasObservedHandCount === true && cardCount === player.observedHandCount
}

function collectStageCards(event: MoveEventDraft, room: Room, fromSeat: SeatID): Card[] {
  const handCards = getPlayerHandCards(room, fromSeat)
  const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []))

  // 协议正 ID 表示这些身份对本机已公开；登记批次前先对齐 isKnown，
  // 避免己方整手正 ID 进交换区后仍被当暗实体处理。
  if (protocolKnownIDs.size > 0) {
    handCards.forEach((card) => {
      if (protocolKnownIDs.has(card.id) && card.isKnown !== true) {
        card.confirmKnown()
      }
    })
  }

  return handCards
}

function splitKnownAndUnknownCards(cards: Card[]): {
  knownIDs: number[]
  unknownCards: Card[]
} {
  const knownIDs: number[] = []
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

function buildExchangePatch(
  event: MoveEventDraft,
  room: Room,
  cards: Card[],
  spellID: number,
  label: string
): MoveEventDraft {
  const { knownIDs, unknownCards } = splitKnownAndUnknownCards(cards)
  const cardCount = Math.max(getCount(event), cards.length)
  // 明暗同批不能共用 combinationID：Room 会把 known 组与 unknown 组合并，
  // ConstraintGroup.known 被 OR 为 true 后会 confirmKnown 整组暗牌。
  const isPureBatch = knownIDs.length === 0 || unknownCards.length === 0

  return patchEvent(event, {
    cardIDs: knownIDs,
    options: {
      ...(unknownCards.length > 0 ? { sourceCards: unknownCards } : {}),
      cardCount,
      ...(isPureBatch ? { combinationID: nextGroupID(room, spellID, label) } : {})
    }
  })
}

function stageHandToExchange(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const raw = getRaw(event)
  const fromSeat = Number(raw.FromID)
  if (!Number.isFinite(fromSeat)) return event
  if (!isWholeHandExchangeStage(event, room, fromSeat)) return event

  const handCards = collectStageCards(event, room, fromSeat)
  if (handCards.length === 0) return event

  const cardCount = Math.max(getCount(event), handCards.length)
  const state = getSpellExchangeState(room, spellID)
  state.batches[String(fromSeat)] = {
    cards: handCards.slice(),
    cardCount,
    fromSeat,
    spellID
  }

  return buildExchangePatch(event, room, handCards, spellID, 'hand_exchange_stage')
}

function returnExchangeBatchToHand(
  event: MoveEventDraft,
  room: Room,
  spellID: number
): MoveEventDraft {
  const raw = getRaw(event)
  const batchKey = String(raw.FromID)
  const state = getSpellExchangeState(room, spellID)
  const batch = state.batches[batchKey]
  if (!batch) return event

  const stagedCards = batch.cards.filter((card) => card.location === 'exchange')
  delete state.batches[batchKey]
  if (Object.keys(state.batches).length === 0) {
    clearSpellExchangeState(room, spellID)
  }

  if (stagedCards.length === 0) return event

  // 回手协议也可能带正 ID；与进区一致，先对齐批次内对应实体的公开状态。
  const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []))
  if (protocolKnownIDs.size > 0) {
    stagedCards.forEach((card) => {
      if (protocolKnownIDs.has(card.id) && card.isKnown !== true) {
        card.confirmKnown()
      }
    })
  }

  return buildExchangePatch(event, room, stagedCards, spellID, 'hand_exchange_return')
}

/**
 * 通用整手牌交换装饰：不绑定具体 SpellID。
 * 协议模式：
 * - MoveType=11
 * - 手牌 -> 交换区（5 -> 10）：按 FromID 登记整批；允许协议正 CardIDs（己方整手）
 * - 交换区 -> 手牌（10 -> 5）：FromID 是原持有者批次键，目标座位看 ToID
 */
export default function decorateHandExchange(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  if (Number(raw.MoveType ?? event.moveType ?? event.options?.moveType) !== MOVE_TYPE.EXCHANGE) {
    return event
  }

  const fromZone = Number(raw.FromZone)
  const toZone = Number(raw.ToZone)
  const spellID = resolveSpellID(event)

  if (fromZone === 5 && toZone === 10) {
    return stageHandToExchange(event, room, spellID)
  }

  if (fromZone === 10 && toZone === 5) {
    return returnExchangeBatchToHand(event, room, spellID)
  }

  return event
}
