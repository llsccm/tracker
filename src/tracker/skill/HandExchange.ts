/**
 * 整手牌经交换区互易装饰器。
 *
 * 协议模式（不绑定单一 SpellID；技能 121 是完整实战样例）：
 * 1. MoveType=11
 * 2. 手牌 -> 交换区：5 -> 10，FromID=原持有座位
 * 3. 交换区 -> 手牌：10 -> 5，FromID=原持有者批次键，ToID=目标座位
 *
 * 默认移动路径无法处理的问题：
 * - 交换区可能同时暂存双方批次，按 zone 顶/底取牌会串批
 * - 整手常混有明牌与暗实体；正 CardIDs 与空 CardIDs 都可能出现
 * - FromZone=10 时 FromID 不能当座位解释，只能当批次键
 *
 * 详细协议说明见：
 * docs/protocols/PubGsCMoveCard-spell-121-hand-exchange.md
 */
import { MOVE_TYPE } from '../MoveEventNormalizer'
import type { Card } from '../Card'
import type { Room } from '../Room'
import type { SeatID } from '../types'
import { recordTraversal } from '../traversalStats'

/** 兼容旧导出名；整手交换已不再绑定单一技能 ID。 */
export const HAND_EXCHANGE_SPELL_ID = 121

/**
 * 房间级 skillState key。
 * value 形态：{ bySpell: { [spellID]: { batches: { [fromSeat]: batch } } } }
 * 按 SpellID 隔离，避免两个交换技能并发时串批。
 */
export const HAND_EXCHANGE_STATE_KEY = 'handExchangeBatches'

type MoveEventDraft = any

/** 某座位进交换区时登记的一整批手牌实体。 */
type HandExchangeBatch = {
  /** 进区时快照的实体列表；回手时只取仍在 exchange 的成员。 */
  cards: Card[]
  /** 协议整手数；用于保留 cardCount，避免明暗拆分后张数丢失。 */
  cardCount: number
  /** 原持有座位；也是 batches 字典的 key。 */
  fromSeat: SeatID
  spellID: number
}

/** 单个 SpellID 下尚未取回的进区批次。 */
type HandExchangeSpellState = {
  batches: Record<string, HandExchangeBatch>
}

/** 房间内所有交换技能的批次账本。 */
type HandExchangeRoomState = {
  bySpell: Record<string, HandExchangeSpellState>
}

function getRaw(event: MoveEventDraft): any {
  return event.raw ?? event.options?.sourceEvent?.raw ?? {}
}

function getCount(event: MoveEventDraft): number {
  return Math.max(0, Number(event.cardCount ?? event.options?.cardCount ?? 0))
}

/** 协议 CardIDs 中的正 ID；0 / 负数 / 非法值不参与 known 对齐。 */
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

/** 可写读取：进区登记时才创建房间账本。 */
function getRoomExchangeState(room: Room): HandExchangeRoomState {
  return room.getSkillState(HAND_EXCHANGE_STATE_KEY, () => ({
    bySpell: {}
  })) as HandExchangeRoomState
}

/**
 * 只读读取：不存在则返回 undefined，避免查询路径留下空 skillState。
 * 回手 / 清理 都应走这条路径。
 */
function getRoomExchangeStateReadonly(room: Room): HandExchangeRoomState | undefined {
  return room.skillState.get(HAND_EXCHANGE_STATE_KEY) as HandExchangeRoomState | undefined
}

/** 可写读取：确保指定 SpellID 的批次字典存在。 */
function getSpellExchangeState(room: Room, spellID: number): HandExchangeSpellState {
  const roomState = getRoomExchangeState(room)
  const key = String(spellID)
  if (!roomState.bySpell[key]) {
    roomState.bySpell[key] = { batches: {} }
  }
  return roomState.bySpell[key]
}

/** 只读读取：未登记过该 SpellID 时不创建空字典。 */
function getSpellExchangeStateReadonly(
  room: Room,
  spellID: number
): HandExchangeSpellState | undefined {
  return getRoomExchangeStateReadonly(room)?.bySpell[String(spellID)]
}

/** 某 SpellID 的批次全部取回后清理；房间账本空了再删 skillState key。 */
function clearSpellExchangeState(room: Room, spellID: number): void {
  const roomState = getRoomExchangeStateReadonly(room)
  if (!roomState) return
  delete roomState.bySpell[String(spellID)]
  if (Object.keys(roomState.bySpell).length === 0) {
    room.clearSkillState(HAND_EXCHANGE_STATE_KEY)
  }
}

/**
 * 收集某座位当前手牌实体（明牌 + 暗实体 + 候选明牌）。
 * 优先扫 player 快照而不是 room.cards 全牌池；仍对访问量做 traversal 插桩。
 */
function getPlayerHandCards(room: Room, seatID: SeatID): Card[] {
  // 装饰阶段优先复用 player 快照，避免每次进区都扫 room.cards 全牌池。
  const playerCards = room.refreshPlayerSnapshot()
  recordTraversal('handExchange:playerHand', playerCards.length)
  return playerCards.filter((card) => card.subZone === 'hand' && card.seats.has(seatID))
}

/**
 * 整手进区门槛：
 * - 调用方已收集 handCards，这里只做张数判断，避免二次扫描
 * - CardCount 等于本地手牌实体数，或等于已观测手牌数
 * - 允许协议带正 CardIDs（常见于己方整手），不要求全暗
 *
 * 不接管佐练单张 5->10、诫厉暂存后回牌堆等非整手路径。
 */
function isWholeHandExchangeStage(
  event: MoveEventDraft,
  room: Room,
  fromSeat: SeatID,
  handCards: Card[]
): boolean {
  if (handCards.length === 0) return false

  const cardCount = getCount(event)
  if (!(cardCount > 0)) return false

  // 本地实体数已对齐协议张数：最常见、也最可靠。
  if (cardCount === handCards.length) return true

  // 本地实体可能因候选/占位尚未完全对齐，但观测手牌数已确认整手。
  const player = room.getPlayer(fromSeat)
  return player?.hasObservedHandCount === true && cardCount === player.observedHandCount
}

/**
 * 用协议正 ID 对齐实体公开态。
 * 本机视角的己方整手可能给出全部正 ID，但本地 isKnown 仍可能为 false；
 * 不在进区/回手前 confirmKnown，后续会把它们当暗实体塞进 sourceCards。
 */
function alignProtocolKnownCards(event: MoveEventDraft, cards: Card[]): void {
  const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []))

  // 协议正 ID 表示这些身份对本机已公开；登记批次前先对齐 isKnown，
  // 避免己方整手正 ID 进交换区后仍被当暗实体处理。
  if (protocolKnownIDs.size > 0) {
    cards.forEach((card) => {
      if (protocolKnownIDs.has(card.id) && card.isKnown !== true) {
        card.confirmKnown()
      }
    })
  }
}

/**
 * 把批次拆成 Room.moveCards 可消费的两路：
 * - knownIDs -> cardIDs（按正 ID 搬走明牌）
 * - unknownCards -> options.sourceCards（按实体搬走暗牌）
 */
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

/**
 * 生成进区/回手补丁。
 * 明暗同批不能共用 combinationID：Room 会把 known 组与 unknown 组合并，
 * ConstraintGroup.known 被 OR 为 true 后会 confirmKnown 整组暗牌。
 */
function buildExchangePatch(
  event: MoveEventDraft,
  room: Room,
  cards: Card[],
  spellID: number,
  label: string
): MoveEventDraft {
  const { knownIDs, unknownCards } = splitKnownAndUnknownCards(cards)
  const cardCount = Math.max(getCount(event), cards.length)
  // 纯明或纯暗才挂 combinationID；混批只靠 cardIDs + sourceCards 分别移动。
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

/**
 * 手牌 -> 交换区（5 -> 10）。
 * 流程：收集一次手牌 -> 校验整手 -> 对齐协议正 ID -> 登记批次 -> 拆明暗补丁。
 * 账本 key 使用 FromID（原持有座位），回手时协议会把同一值放回 FromID。
 */
function stageHandToExchange(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const raw = getRaw(event)
  const fromSeat = Number(raw.FromID)
  if (!Number.isFinite(fromSeat)) return event

  // 同一次进区只扫一次手牌，门槛判断与批次登记复用同一结果。
  const handCards = getPlayerHandCards(room, fromSeat)
  if (!isWholeHandExchangeStage(event, room, fromSeat, handCards)) return event

  alignProtocolKnownCards(event, handCards)
  if (handCards.length === 0) return event

  const cardCount = Math.max(getCount(event), handCards.length)
  // 只有确认接管后才创建可写账本，避免非整手路径污染 skillState。
  const state = getSpellExchangeState(room, spellID)
  state.batches[String(fromSeat)] = {
    cards: handCards.slice(),
    cardCount,
    fromSeat,
    spellID
  }

  return buildExchangePatch(event, room, handCards, spellID, 'hand_exchange_stage')
}

/**
 * 交换区 -> 手牌（10 -> 5）。
 * FromID 是进区时登记的批次键（原持有者），不是目标座位；目标座位在 ToID。
 * 查询未命中时只读返回，不创建空账本。
 */
function returnExchangeBatchToHand(
  event: MoveEventDraft,
  room: Room,
  spellID: number
): MoveEventDraft {
  const raw = getRaw(event)
  // 回手协议：FromID = 原持有者批次键；ToID = 真正接收座位。
  const batchKey = String(raw.FromID)
  const state = getSpellExchangeStateReadonly(room, spellID)
  const batch = state?.batches[batchKey]
  if (!batch) return event

  // 批次可能被中途打断；只取仍停在 exchange 的实体，避免把已离开的牌再搬一次。
  const stagedCards = batch.cards.filter((card) => card.location === 'exchange')
  delete state.batches[batchKey]
  if (Object.keys(state.batches).length === 0) {
    clearSpellExchangeState(room, spellID)
  }

  if (stagedCards.length === 0) return event

  // 回手协议也可能带正 ID；与进区一致，先对齐批次内对应实体的公开状态。
  alignProtocolKnownCards(event, stagedCards)

  return buildExchangePatch(event, room, stagedCards, spellID, 'hand_exchange_return')
}

/**
 * 通用整手牌交换装饰：不绑定具体 SpellID。
 * 只处理 MoveType=11 且 zone 为 5<->10 的路径；其余事件原样返回。
 *
 * 协议模式：
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
