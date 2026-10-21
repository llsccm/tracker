import type { Card } from '@/tracker/model'
import type { Room } from '../Room'
import type { SeatInput } from './movement/types'
import type { MoveOptions, NormalizedMoveEvent, SpellID } from '../types'
import { summarizeMoveEvent } from '../helper/moveSummary'
import { trackerLogger } from '@/utils/logger'

export type MoveEventHandler = (
  event: NormalizedMoveEvent,
  room: Room
) => NormalizedMoveEvent | null | undefined | void

export type SkillHandler = (
  card: Card,
  context: Pick<MoveOptions, 'subZone' | 'sourceEvent'> & {
    toSeatID: SeatInput | null
    toZone: NormalizedMoveEvent['toZone']
  }
) => unknown

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

  /** 技能处理器 */
  decorateMoveEvent(event: NormalizedMoveEvent): NormalizedMoveEvent {
    const spellIDs = Array.from(new Set([event.protocol.SpellID, event.options.spellID])).filter(
      (spellID) => spellID != null
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
    }, event)
  }

  clear(): void {
    this.skills.clear()
    this.handlers.clear()
  }
}
