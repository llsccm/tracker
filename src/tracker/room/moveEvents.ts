import { normalizeMoveCardFields } from '../MoveEventNormalizer'
import type { Card } from '../Card'
import type { Room } from '../Room'
import type { SeatInput } from '../roomMovement/types'
import type { MoveOptions, NormalizedMoveEvent, RawMoveCardEvent, SpellID } from '../types'
import { summarizeMoveEvent } from '../helper/moveSummary'
import { trackerLogger } from '@/utils/logger'

/** 有 protocol 的事件必须完整；领域调用可省略协议及可从中派生的字段。 */
export type MoveEventInput =
  | NormalizedMoveEvent
  | (Omit<Partial<NormalizedMoveEvent>, 'protocol' | 'toZone'> & {
      protocol?: undefined
      toZone: NormalizedMoveEvent['toZone']
    })

export type MoveEventHandler = (
  event: NormalizedMoveEvent,
  room: Room
) => NormalizedMoveEvent | null | undefined | void

export type SkillHandler = (
  card: Card,
  context: Pick<MoveOptions, 'subZone' | 'sourceEvent'> & {
    seatID: SeatInput | null
    toZone: NormalizedMoveEvent['toZone']
  }
) => unknown

function collectSpellIDs(value: unknown): unknown[] {
  if (value === null || value === undefined) return []
  if (
    typeof value === 'object' &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === 'function'
  ) {
    return Array.from(value as Iterable<unknown>).flatMap(collectSpellIDs)
  }
  return [value]
}

function hasNormalizedProtocol(event: MoveEventInput): event is NormalizedMoveEvent {
  return Boolean(event.protocol)
}

function normalizeEvent(event: MoveEventInput): NormalizedMoveEvent {
  if (hasNormalizedProtocol(event)) return event

  const raw: RawMoveCardEvent = event.raw ?? event.options?.sourceEvent?.raw ?? {}
  const protocol = normalizeMoveCardFields({
    ...raw,
    CardIDs: event.cardIDs ?? raw.CardIDs,
    CardCount: event.cardCount ?? event.options?.cardCount ?? raw.CardCount,
    MoveType: raw.MoveType ?? event.moveType ?? event.options?.moveType,
    SpellID: raw.SpellID ?? event.options?.spellID
  })
  return {
    ...event,
    // 领域直调不重新推断协议分支；统一使用普通移动类型。
    type: event.type ?? 'moveCards',
    protocol,
    cardIDs: event.cardIDs ?? protocol.CardIDs,
    cardCount: event.cardCount ?? protocol.CardCount,
    moveType: event.moveType ?? protocol.MoveType,
    options: event.options ?? {}
  }
}

/** 处理器注册与装饰顺序集中管理，不拥有任何卡牌推断状态。 */
export class RoomMoveEvents {
  private readonly skills = new Map<SpellID, SkillHandler>()
  private readonly handlers = new Map<SpellID | '*', MoveEventHandler[]>()

  constructor(private readonly room: Room) {}

  get skillHandlers(): ReadonlyMap<SpellID, SkillHandler> {
    return this.skills
  }

  get moveEventHandlers(): ReadonlyMap<SpellID | '*', readonly MoveEventHandler[]> {
    return this.handlers
  }

  registerSkillHandler(spellID: SpellID, handler: SkillHandler): void {
    this.skills.set(spellID, handler)
  }

  registerMoveEventHandler(spellID: SpellID | '*', handler: MoveEventHandler): void {
    const key = spellID === '*' ? '*' : Number(spellID)
    if (key !== '*' && !Number.isFinite(key)) return
    const handlers = this.handlers.get(key)
    if (handlers) handlers.push(handler)
    else this.handlers.set(key, [handler])
  }

  decorateMoveEvent(event: MoveEventInput): NormalizedMoveEvent {
    if (event === null) return null
    if (event === undefined) return undefined
    const normalized = normalizeEvent(event)
    const spellIDs = Array.from(
      new Set(
        [normalized.protocol.SpellID, normalized.options.spellID]
          .flatMap(collectSpellIDs)
          .map(Number)
          .filter(Number.isFinite)
      )
    )
    const handlers = [
      ...(this.handlers.get('*') ?? []),
      ...spellIDs.flatMap((spellID) => this.handlers.get(spellID) ?? [])
    ]
    return handlers.reduce((nextEvent, handler) => {
      try {
        const decorated = handler(nextEvent, this.room)
        return decorated ? decorated : nextEvent
      } catch (error) {
        trackerLogger.warn('移动事件装饰失败', {
          spellIDs,
          event: summarizeMoveEvent(nextEvent)
        })
        console.error('[Refactor] 移动事件装饰失败:', error, nextEvent)
        return nextEvent
      }
    }, normalized)
  }

  clear(): void {
    this.skills.clear()
    this.handlers.clear()
  }
}
