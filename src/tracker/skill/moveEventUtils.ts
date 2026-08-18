import { CARD_INSTANCE_STATUS } from '../CardCounter'
import type { Card } from '../Card'
import type { Room } from '../Room'
import type { CardID, NormalizedMoveEvent, SubZone } from '../types'

/** 技能移动装饰器消费并返回的完整标准化移动事件。 */
export type MoveEventDraft = NormalizedMoveEvent

/**
 * `patchEvent` 接受的浅补丁。
 *
 * 事件顶层字段可以按需替换；`options` 单独声明为可选字段集合，表示补丁会与原
 * `options` 合并，而不是要求调用方重新提供完整配置。
 */
export type MoveEventPatch = Omit<Partial<MoveEventDraft>, 'options'> & {
  options?: Partial<MoveEventDraft['options']>
}

/**
 * 读取技能判断所需的原始协议消息。
 *
 * 优先使用当前标准化事件携带的 `raw`；装饰器生成的派生事件没有 `raw` 时，回退到
 * `sourceEvent.raw`。原始协议仍包含未完全建模的技能私有字段，因此此处保留宽松返回类型。
 */
export function getRaw(event: MoveEventDraft): any {
  return event.raw ?? event.options?.sourceEvent?.raw ?? {}
}

/** 读取事件声明的牌数，优先使用事件顶层值，并把负数限制为 0。 */
export function getCount(event: MoveEventDraft): number {
  return Math.max(0, Number(event.cardCount ?? event.options?.cardCount ?? 0))
}

/** 判断协议牌 ID 中是否至少明确提供了一张真实身份牌。 */
export function hasPositiveID(cardIDs: readonly CardID[] = []): boolean {
  return cardIDs.some((id) => id > 0)
}

/**
 * 分配当前 Room 内唯一的约束组 ID。
 *
 * 调用会推进 `constraintGroupSeq`，因此只应在确定需要创建新约束组时执行。
 */
export function nextGroupID(room: Room, spellID: number | string, label: string): string {
  return `${label}_${spellID}_${++room.constraintGroupSeq}`
}

/**
 * 在不修改原事件的前提下应用移动事件补丁。
 *
 * 顶层字段执行浅合并，`options` 再单独执行一层浅合并；未提供 `cardIDs` 时沿用原值。
 * 函数不会深拷贝补丁中的数组或对象。
 */
export function patchEvent(event: MoveEventDraft, patch: MoveEventPatch = {}): MoveEventDraft {
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

/**
 * 获取事件所声明公共来源区的实体牌。
 *
 * 数字协议区和空值还未映射为 Room 公共区名称，不能直接作为 `room.zones` 的键。
 */
export function getSourceZoneCards(event: MoveEventDraft, room: Room): Card[] {
  const zoneID = event.options?.fromZone
  if (typeof zoneID !== 'string') return []
  return room.zones.get(zoneID)?.cards ?? []
}

/**
 * 按事件信息推断本次移动实际应消费的来源实体。
 *
 * 优先使用协议给出的正 ID；否则从明确玩家子区挑选暗牌；公共区来源最后按牌顶优先
 * 顺序补足。返回数量最多为事件声明的 `cardCount`。
 */
export function getEventSourceCards(event: MoveEventDraft, room: Room): Card[] {
  const count = getCount(event)
  const knownCards = room.findCardsByIDs(event.cardIDs)
  if (knownCards.length > 0) return knownCards.slice(0, count)

  const fromSeat = event.options?.fromSeatID
  if (fromSeat !== undefined && fromSeat !== null) {
    return getUnknownPlayerCards(room, fromSeat, count, event.options?.fromSubZone ?? 'hand')
  }

  return getTopFirstCards(getSourceZoneCards(event, room)).slice(0, count)
}

/** 从明确玩家子区中按现有实体顺序选取指定数量的未公开牌。 */
function getUnknownPlayerCards(
  room: Room,
  seatID: unknown,
  count: number,
  subZone: SubZone = 'hand'
): Card[] {
  const seat = Number(seatID)
  if (Number.isNaN(seat)) return []

  const playerCards: Card[] = []
  if (!(count > 0)) return playerCards

  // Counter 的 UNKNOWN 桶是增量索引；Counter 尚未初始化时回退 Room 全牌集合。
  const unknownCards = room.counter?.cardsByStatus?.[CARD_INSTANCE_STATUS.UNKNOWN] ?? room.cards
  for (const card of unknownCards) {
    if (
      card.location === 'player' &&
      card.subZone === subZone &&
      card.seats.has(seat) &&
      card.isKnown !== true
    ) {
      playerCards.push(card)
      if (playerCards.length >= count) break
    }
  }

  return playerCards
}

/** 将公共区内部的“底到顶”数组复制并转换为“顶到底”读取顺序。 */
export function getTopFirstCards<T>(cards: readonly T[] = []): T[] {
  return cards.slice().reverse()
}

/**
 * 为全暗协议补充已推断的来源实体。
 *
 * 协议已携带正 ID 时必须继续让精确身份路径处理，不能用 `sourceCards` 覆盖它。
 */
export function createSourcePatch(
  event: MoveEventDraft,
  cards: Card[]
): Pick<MoveEventDraft['options'], 'sourceCards'> {
  if (hasPositiveID(event.cardIDs)) return {}
  return cards.length > 0 ? { sourceCards: cards } : {}
}

/** 兼容既有技能导入；通用实现位于 tracker helper，避免核心模块反向依赖 skill。 */
export { getPositiveIDs } from '../helper/cardIDs'
