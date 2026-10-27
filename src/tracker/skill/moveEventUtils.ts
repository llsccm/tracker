import { CARD_INSTANCE_STATUS } from '../projection/CardCounter'
import type { Card } from '@/tracker/model/Card'
import type { Room } from '../Room'
import type { CardID, NormalizedMoveEvent, SeatID, SubZone } from '../types'

/** 技能移动装饰器消费并返回的完整标准化移动事件。 */
export type MoveEventDraft = NormalizedMoveEvent

/**
 * `patchEvent` 接受的浅补丁。
 *
 * 只允许修改领域分支、身份和数量；不覆盖原始协议或追溯数据。
 * `options` 本身已定义可选字段，补丁只与原选项浅合并。
 */
export type MoveEventPatch = Partial<
  Pick<MoveEventDraft, 'type' | 'cardIDs' | 'cardCount' | 'from' | 'to'>
> & {
  options?: MoveEventDraft['options']
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

/** 读取当前标准事件的移动牌数；格式化由入口统一完成。 */
export function getCount(event: MoveEventDraft): number {
  return event.cardCount
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
    type: patch.type ?? event.type,
    cardIDs: patch.cardIDs ?? event.cardIDs,
    cardCount: patch.cardCount ?? event.cardCount,
    from: patch.from ?? event.from,
    to: patch.to ?? event.to,
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
  if (event.from.type !== 'public') return []
  return room.zones.get(event.from.zone)?.cards ?? []
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

  if (event.from.type === 'player') {
    return getUnknownPlayerCards(room, event.from.seatID, count, event.from.subZone)
  }

  return getTopFirstCards(getSourceZoneCards(event, room)).slice(0, count)
}

/** 从明确玩家子区中按现有实体顺序选取指定数量的未公开牌。 */
function getUnknownPlayerCards(
  room: Room,
  seatID: SeatID | undefined,
  count: number,
  subZone: SubZone = 'hand'
): Card[] {
  if (seatID === undefined) return []

  const playerCards: Card[] = []
  if (!(count > 0)) return playerCards

  // Counter 的 UNKNOWN 桶是增量索引；Counter 尚未初始化时回退 Room 全牌集合。
  const unknownCards = room.counter?.cardsByStatus?.[CARD_INSTANCE_STATUS.UNKNOWN] ?? room.cards
  for (const card of unknownCards) {
    if (
      card.location === 'player' &&
      card.subZone === subZone &&
      card.seats.has(seatID) &&
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
