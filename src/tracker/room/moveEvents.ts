import { getMoveCallbackSpellID } from '@/tracker/helper/moveEndpoint'
import type { Card } from '@/tracker/model'
import type { Room } from '../Room'
import type {
  CardID,
  MoveRoute,
  MoveSourceEvent,
  NormalizedMoveEvent,
  PatchedMoveCardFields,
  RawMoveCardEvent,
  SpellID
} from '../types'
import type { PendingSkillMove, SkillProtocolEvent } from '../skill/protocolEvents'
import { summarizeMoveEvent } from '../helper/moveSummary'
import { trackerLogger } from '@/utils/logger'

export type MoveEventHandler = (
  event: NormalizedMoveEvent,
  room: Room
) => NormalizedMoveEvent | null | undefined | void

export type SkillHandler = (
  card: Card,
  context: MoveRoute & { sourceEvent?: MoveSourceEvent }
) => unknown

export interface RoomSkillPlugin {
  readonly id: string
  readonly spellIDs?: readonly (SpellID | '*')[]
  beforeNormalizeMove?: (
    patched: PatchedMoveCardFields,
    raw: Readonly<RawMoveCardEvent>,
    room: Room
  ) => 'defer' | void
  decorateMove?: MoveEventHandler
  afterMoveCommitted?: (event: NormalizedMoveEvent, room: Room) => void
  onCardsRevealed?: (cardIDs: readonly CardID[], room: Room) => void
  onProtocolEvent?: (event: SkillProtocolEvent, room: Room) => PendingSkillMove | void
  onDeckInitialized?: (room: Room) => void
}

/** 处理器注册与装饰顺序集中管理，不拥有任何卡牌推断状态。 */
export class RoomMoveEvents {
  private readonly skills = new Map<SpellID, SkillHandler>()
  private readonly plugins = new Map<string, RoomSkillPlugin>()
  private legacySequence = 0

  constructor(private readonly room: Room) {}

  get skillHandlers(): ReadonlyMap<SpellID, SkillHandler> {
    return this.skills
  }

  get moveEventHandlers(): ReadonlyMap<SpellID | '*', readonly MoveEventHandler[]> {
    const handlers = new Map<SpellID | '*', MoveEventHandler[]>()
    for (const plugin of this.plugins.values()) {
      if (!plugin.decorateMove) continue
      for (const spellID of new Set<SpellID | '*'>(plugin.spellIDs ?? ['*'])) {
        const registered = handlers.get(spellID)
        if (registered) registered.push(plugin.decorateMove)
        else handlers.set(spellID, [plugin.decorateMove])
      }
    }
    return handlers
  }

  registerSkillHandler(spellID: SpellID, handler: SkillHandler): void {
    this.skills.set(spellID, handler)
  }

  registerMoveEventHandler(spellID: SpellID | '*', handler: MoveEventHandler): void {
    this.registerSkillPlugin({
      id: `legacy:${++this.legacySequence}`,
      spellIDs: [spellID],
      decorateMove: handler
    })
  }

  registerSkillPlugin(plugin: RoomSkillPlugin): void {
    if (this.plugins.has(plugin.id)) throw new Error(`技能插件重复注册: ${plugin.id}`)
    this.plugins.set(plugin.id, plugin)
  }

  private selectPlugins(spellIDs: readonly SpellID[]): RoomSkillPlugin[] {
    const plugins = [...this.plugins.values()]
    const wildcard = plugins.filter((plugin) => !plugin.spellIDs || plugin.spellIDs.includes('*'))
    const selected = new Set(wildcard)
    for (const spellID of spellIDs) {
      for (const plugin of plugins) {
        if (plugin.spellIDs?.includes(spellID)) selected.add(plugin)
      }
    }
    return [...selected]
  }

  beforeNormalizeMove(
    patched: PatchedMoveCardFields,
    raw: Readonly<RawMoveCardEvent>
  ): 'defer' | void {
    for (const plugin of this.selectPlugins([patched.SpellID])) {
      if (plugin.beforeNormalizeMove?.(patched, raw, this.room) === 'defer') return 'defer'
    }
  }

  /** 技能处理器 */
  decorateMoveEvent(event: NormalizedMoveEvent): NormalizedMoveEvent {
    const spellIDs = Array.from(
      new Set([event.protocol.SpellID, getMoveCallbackSpellID(event, event.protocol.SpellID)])
    ).filter((spellID) => spellID != null)
    return this.selectPlugins(spellIDs).reduce((nextEvent, plugin) => {
      try {
        const decorated = plugin.decorateMove?.(nextEvent, this.room)
        return decorated ? decorated : nextEvent
      } catch (error) {
        trackerLogger.warn('移动事件装饰失败', {
          pluginID: plugin.id,
          spellIDs,
          event: summarizeMoveEvent(nextEvent)
        })
        console.error('[Refactor] 移动事件装饰失败:', error, nextEvent)
        return nextEvent
      }
    }, event)
  }

  afterMoveCommitted(event: NormalizedMoveEvent): void {
    this.notifyPlugins(
      this.selectPlugins(
        [event.protocol.SpellID, getMoveCallbackSpellID(event, event.protocol.SpellID)].filter(
          (id) => id != null
        )
      ),
      'afterMoveCommitted',
      (plugin) => plugin.afterMoveCommitted?.(event, this.room)
    )
  }

  notifyCardsRevealed(cardIDs: readonly CardID[]): void {
    const ids = Object.freeze([...new Set(cardIDs.filter((id) => id > 0))])
    if (ids.length === 0) return
    this.notifyPlugins(this.plugins.values(), 'onCardsRevealed', (plugin) =>
      plugin.onCardsRevealed?.(ids, this.room)
    )
  }

  dispatchSkillProtocolEvent(event: SkillProtocolEvent): PendingSkillMove[] {
    const moves: PendingSkillMove[] = []
    // DataID / Type 不能当作 SpellID；非移动协议由插件按判别联合自行识别。
    for (const plugin of this.plugins.values()) {
      const move = plugin.onProtocolEvent?.(event, this.room)
      if (move) moves.push(move)
    }
    return moves
  }

  onDeckInitialized(): void {
    this.notifyPlugins(this.plugins.values(), 'onDeckInitialized', (plugin) =>
      plugin.onDeckInitialized?.(this.room)
    )
  }

  private notifyPlugins(
    plugins: Iterable<RoomSkillPlugin>,
    phase: string,
    notify: (plugin: RoomSkillPlugin) => void
  ): void {
    for (const plugin of plugins) {
      try {
        notify(plugin)
      } catch (error) {
        trackerLogger.warn('技能生命周期通知失败', { pluginID: plugin.id, phase, error })
      }
    }
  }

  clear(): void {
    this.skills.clear()
    this.plugins.clear()
    this.legacySequence = 0
  }
}
