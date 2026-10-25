import {
  getMoveZone,
  getMoveSubZone,
  getMoveTargetSeats,
  getMoveMarkSpellID,
  getMoveSeat
} from '@/tracker/helper/moveEndpoint'
import { getEquipmentMarkContainerByMarkSpellID } from '@/tracker/candidate/equipmentMarkContainer'
import {
  normalizeLocationCandidate,
  type LocationCandidateInput
} from '@/tracker/candidate/locationCandidate'
import type { Card } from '@/tracker/model'
import type { CardID, SeatID, SpellID, SubZoneCandidate } from '@/tracker/types'
import type { RoomMoveContext } from './types'

export interface EquipmentMarkSeatChange {
  markSpellID: SpellID
  targetSeat: SeatID
  /** 只有同一标记空间跨座位移动时才有值；普通暗置只提供目标座位观测。 */
  transferFromSeat: SeatID | null
}

export interface ObservedEquipmentMarkSnapshot {
  markSpellID: SpellID
  observedSeat: SeatID
}

/** 装备容器规则只读输入，不访问 HiddenMarkState，也不维护实体、账本或约束。 */
export function resolveEquipmentContainerLocationCandidates(
  candidate: LocationCandidateInput,
  cardIndex: ReadonlyMap<CardID, Card>,
  observedMarkSeat: SeatID | null | undefined
): SubZoneCandidate[] {
  const normalized = normalizeLocationCandidate(candidate)
  if (normalized?.type !== 'container' || normalized.containerType !== 'equipment') return []

  const equipment = cardIndex.get(normalized.cardID)
  // 装备本体离开装备区后标记空间不再存在，不能继续投影到旧观测座位。
  if (equipment?.location !== 'player' || equipment.subZone !== 'equip') return []

  const container =
    normalized.spellID === null ? null : getEquipmentMarkContainerByMarkSpellID(normalized.spellID)
  const markSeat = container?.equipmentCardID === normalized.cardID ? observedMarkSeat : null
  // 已观察到 mark700 后只按标记协议更新座位；尚无观测时才回退到装备位置。
  const seats =
    markSeat !== null && markSeat !== undefined ? [markSeat] : Array.from(equipment.seats)

  return seats.map((seatID) => ({
    type: 'player',
    seatID,
    subZone: 'mark',
    spellID: normalized.spellID
  }))
}

/** 识别目标装备标记空间及真正的跨座迁移；数量与状态写入时机由调用阶段负责。 */
export function getEquipmentMarkSeatChange(
  context: RoomMoveContext,
  markSpellID: SpellID | null | undefined = getMoveMarkSpellID(context.to)
): EquipmentMarkSeatChange | null {
  if (
    markSpellID == null ||
    getMoveZone(context.to) !== 'player' ||
    getMoveSubZone(context.to) !== 'mark' ||
    getMoveTargetSeats(context.to).length !== 1 ||
    getMoveMarkSpellID(context.to) !== markSpellID
  ) {
    return null
  }

  const container = getEquipmentMarkContainerByMarkSpellID(markSpellID)
  if (!container) return null

  const targetSeat = getMoveTargetSeats(context.to)[0]
  const sourceSpellID = getMoveMarkSpellID(context.from)
  const transferFromSeat =
    getMoveSubZone(context.from) === 'mark' &&
    sourceSpellID === getMoveMarkSpellID(context.to) &&
    getMoveSeat(context.from) !== null &&
    getMoveSeat(context.from) !== targetSeat
      ? getMoveSeat(context.from)
      : null

  return { markSpellID: container.markSpellID, targetSeat, transferFromSeat }
}

/** 保持现有木牛账本键；承载座位变化不改变身份，不同来源手牌仍分别记账。 */
export function getEquipmentMarkRecordKey(
  sourceSeat: SeatID,
  spellID: SpellID | null
): string | null {
  if (spellID === null) return null
  const container = getEquipmentMarkContainerByMarkSpellID(spellID)
  return container ? `${sourceSeat}:muniu:${container.equipmentCardID}` : null
}

/**
 * 识别单一目标座位、无暗牌且已知 ID 数量完整的装备标记区快照，不把空 CardIDs 的暗迁座通知解释为清空容器。
 * 返回标记 ID 和观测承载座位；普通标记或不完整快照返回 null，不修改状态。
 */
export function getObservedEquipmentMarkSnapshot(
  context: RoomMoveContext
): ObservedEquipmentMarkSnapshot | null {
  if (
    getMoveZone(context.to) !== 'player' ||
    getMoveSubZone(context.from) !== 'mark' ||
    getMoveSubZone(context.to) !== 'mark' ||
    getMoveTargetSeats(context.to).length !== 1 ||
    context.unknownCount !== 0 ||
    context.knownIDs.length !== context.cardCount
  ) {
    return null
  }

  const markSpellID = getMoveMarkSpellID(context.from)
  if (markSpellID == null) return null
  const container = getEquipmentMarkContainerByMarkSpellID(markSpellID)
  if (!container) return null

  const observedSeat = Number(getMoveTargetSeats(context.to)[0])
  if (!Number.isFinite(observedSeat)) return null

  return { markSpellID: container.markSpellID, observedSeat }
}
