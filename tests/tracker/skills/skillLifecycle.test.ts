import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Room } from '@/tracker/Room'
import type { RoomSkillPlugin } from '@/tracker/room/moveEvents'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import { createTestRoom } from '../helpers/room'
import {
  createErrorSpy,
  protocolMove,
  createReadyControllerHarness
} from '../helpers/trackerController'
import { assertPileIdentityLedgerConsistency } from '@/tracker/room/diagnostics'
import { hasSkillState } from '@/tracker/room/RoomBase'

const rooms: Room[] = []
afterEach(() => {
  rooms.splice(0).forEach((room) => room.destroy())
  vi.restoreAllMocks()
})

function setup() {
  const harness = createReadyControllerHarness({
    players: [1, 2, 7].map((seat) => ({ SeatID: seat, ClientID: seat })),
    currentUserID: 7,
    cardIDs: [11, 12, 13, 14, 15, 16]
  })

  rooms.push(harness.room)
  return harness
}

describe('技能生命周期注册表', () => {
  it('通配优先、按协议与领域技能顺序分发，同插件只执行一次且重复 ID 报错', () => {
    const { room } = createTestRoom()
    rooms.push(room)
    const calls: string[] = []
    room.registerSkillPlugin({
      id: 'specific',
      spellIDs: [42, 99],
      decorateMove: () => {
        calls.push('specific')
      }
    })
    room.registerSkillPlugin({
      id: 'other',
      spellIDs: [99],
      decorateMove: () => {
        calls.push('other')
      }
    })
    room.registerSkillPlugin({
      id: 'wildcard',
      spellIDs: ['*', 42],
      decorateMove: () => {
        calls.push('wildcard')
      }
    })
    let event = normalizeMoveEvent(protocolMove({ SpellID: 42 }))
    event = { ...event, to: { type: 'player', seatID: 1, subZone: 'mark', markSpellID: 99 } }
    room.decorateMoveEvent(event)
    expect(calls).toEqual(['wildcard', 'specific', 'other'])
    expect(() => room.registerSkillPlugin({ id: 'specific' })).toThrow('重复注册')
  })

  it('defer 停止归一化及所有提交通知，原消息保持不变', () => {
    const { controller, room } = setup()
    const after = vi.fn()
    const reveal = vi.fn()
    const later = vi.fn()
    const decorate = vi.spyOn(room, 'decorateMoveEvent')
    room.registerSkillPlugin({
      id: 'defer-test',
      beforeNormalizeMove: () => 'defer',
      afterMoveCommitted: after,
      onCardsRevealed: reveal
    })
    room.registerSkillPlugin({ id: 'later-test', beforeNormalizeMove: later })
    const msg = protocolMove({ CardIDs: [11] })
    controller.syncTrackerMove(msg)
    expect(decorate).not.toHaveBeenCalled()
    expect(later).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
    expect(reveal).not.toHaveBeenCalled()
    expect(room.zones.get('pile')!.cards).toHaveLength(6)
    expect(msg.CardIDs).toEqual([11])
  })

  it('移动成功后通知读取稳定牌位和账本', () => {
    const { controller, room } = setup()
    const notifications: {
      phase: string
      cardIDs: readonly number[]
      ledgerIssues?: ReturnType<typeof assertPileIdentityLedgerConsistency>
    }[] = []
    room.registerSkillPlugin({
      id: 'observer',
      afterMoveCommitted() {
        notifications.push({
          phase: 'committed',
          cardIDs: room.getPlayer(1)!.knownHandCards.map((card) => card.id),
          ledgerIssues: assertPileIdentityLedgerConsistency(room, 'plugin:committed')
        })
      },
      onCardsRevealed(ids) {
        notifications.push({ phase: 'revealed', cardIDs: ids })
      }
    })
    controller.syncTrackerMove(protocolMove({ CardIDs: [11] }))
    expect(notifications).toEqual([
      { phase: 'committed', cardIDs: [11], ledgerIssues: [] },
      { phase: 'revealed', cardIDs: [11] }
    ])
  })

  it.each(['cancel', 'noop'] as const)('%s 不发送成功移动或明牌通知', (failure) => {
    const { controller, room } = setup()
    const committed = vi.fn()
    const revealed = vi.fn()
    const plugin: RoomSkillPlugin = {
      id: 'failure',
      afterMoveCommitted: committed,
      onCardsRevealed: revealed
    }
    if (failure === 'cancel') vi.spyOn(room, 'moveCards').mockReturnValue(false)
    if (failure === 'noop') plugin.decorateMove = (event) => ({ ...event, type: 'noop' })
    room.registerSkillPlugin(plugin)
    controller.syncTrackerMove(protocolMove({ CardIDs: [11] }))
    expect(committed).not.toHaveBeenCalled()
    expect(revealed).not.toHaveBeenCalled()
    expect(room.zones.get('pile')!.cards).toHaveLength(6)
  })

  it('展示、范围揭示、洗牌按成功事件通知，显式揭示不触发移动后钩子', () => {
    const { controller, room } = setup()
    const committed = vi.fn()
    const revealed = vi.fn()
    room.registerSkillPlugin({
      id: 'observe-branches',
      afterMoveCommitted: committed,
      onCardsRevealed: revealed
    })
    controller.syncTrackerMove(protocolMove({ CardIDs: [11] }))
    committed.mockClear()
    revealed.mockClear()
    controller.syncTrackerMove(
      protocolMove({ CardIDs: [11], FromZone: 5, FromID: 1, ToID: 1, MoveType: 21 })
    )
    expect(committed.mock.lastCall?.[0].type).toBe('showCards')
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [12],
        FromZone: 1,
        ToZone: 1,
        ToID: 255,
        MoveType: 21,
        SpellID: 3903,
        FromPosition: 65282,
        ToPosition: 65282
      })
    )
    expect(committed.mock.lastCall?.[0].type).toBe('revealPublicCandidate')
    controller.syncTrackerMove(
      protocolMove({ CardIDs: [11], FromZone: 5, FromID: 1, ToZone: 2, ToID: 255, MoveType: 4 })
    )
    revealed.mockClear()
    controller.syncTrackerMove(
      protocolMove({ CardIDs: [], CardCount: 6, FromZone: 2, ToZone: 9, MoveType: 255 })
    )
    expect(committed.mock.lastCall?.[0].type).toBe('shuffleDiscardIntoPile')
    expect(revealed).not.toHaveBeenCalled()
    committed.mockClear()
    controller.revealTrackerCards({ type: 'public', zoneName: 'pile' }, [13])
    expect(committed).not.toHaveBeenCalled()
    expect(revealed).toHaveBeenCalledExactlyOnceWith([13], room)
  })

  it.each(['explicit', 'show'])('%s 揭示移动失败不发送成功通知', (mode) => {
    const { controller, room } = setup()
    const revealed = vi.fn()
    const committed = vi.fn()
    room.registerSkillPlugin({
      id: 'reveal-failure',
      onCardsRevealed: revealed,
      afterMoveCommitted: committed
    })
    vi.spyOn(room, 'moveCards').mockReturnValue(false)
    if (mode === 'explicit') controller.revealTrackerCards({ type: 'player', seatID: 1 }, [11])
    if (mode === 'show')
      controller.syncTrackerMove(
        protocolMove({ CardIDs: [11], FromZone: 5, FromID: 1, ToID: 1, MoveType: 21 })
      )
    expect(revealed).not.toHaveBeenCalled()
    expect(committed).not.toHaveBeenCalled()
  })

  it('销毁清理插件且不影响其他 Room，重建牌堆清理迁移技能状态', () => {
    const { controller, room } = setup()
    const { room: other } = createTestRoom()
    rooms.push(other)
    const first = vi.fn()
    const second = vi.fn()
    room.registerSkillPlugin({ id: 'shared-id', onCardsRevealed: first })
    other.registerSkillPlugin({ id: 'shared-id', onCardsRevealed: second })
    for (const id of [3157, 3511, 3750, 3434, 3854, 3488, 361, 3709, 'duoQi'])
      room.setSkillState(id, [11])
    controller.initTrackerDeck([11, 12])
    for (const id of [3157, 3511, 3750, 3434, 3854, 3488, 361, 3709, 'duoQi'])
      expect(hasSkillState(room, id)).toBe(false)
    room.destroy()
    room.notifyCardsRevealed([11])
    other.notifyCardsRevealed([11])
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})

describe('非移动协议与补牌集成', () => {
  it.each([3157, 3511, 3434, 3750, 3854])(
    '技能 %i 直接通过 Controller 完成状态采集与补牌，不依赖 Handler',
    (SpellID) => {
      const { controller, room, gameState } = setup()
      const errors = createErrorSpy()
      const ids = [11, 12]
      controller.syncTrackerMove(
        protocolMove({ CardIDs: ids, ToZone: SpellID === 3854 ? 5 : 2, ToID: 1, MoveType: 4 })
      )
      controller.dispatchSkillProtocolEvent({
        type: 'useSpell',
        message: { SpellID, SeatID: 1, EffectIndex: 2, CardIDs: ids, card_count: 2, dest_Count: 0 }
      })
      expect(room.readSkillState(SpellID)).toEqual([11, 12])
      expect(gameState.getSpellState(SpellID)).toBeUndefined()
      const move = protocolMove({
        SpellID,
        CardIDs: [0, 0],
        CardCount: 2,
        FromZone: SpellID === 3854 ? 5 : 2,
        FromID: 1,
        ToZone: SpellID === 3750 ? 1 : 5,
        ToID: 2,
        MoveType: 15
      })
      const decorate = vi.spyOn(room, 'decorateMoveEvent')
      controller.syncTrackerMove(move)
      expect(decorate.mock.lastCall?.[0].cardIDs).toEqual([11, 12])
      expect(decorate.mock.lastCall?.[0].raw.CardIDs).toEqual([0, 0])
      expect(move.CardIDs).toEqual([0, 0])
      expect(hasSkillState(room, SpellID)).toBe(false)
      for (const id of [11, 12]) {
        expect(room.cardIndex.get(id)!.location).toBe(SpellID === 3750 ? 'pile' : 'player')
        if (SpellID !== 3750) expect(room.cardIndex.get(id)!.owner).toBe(2)
      }
      expect(assertPileIdentityLedgerConsistency(room, 'plugin:patch')).toEqual([])
      expect(errors).not.toHaveBeenCalled()
    }
  )

  it('下书失败移动保留选择，重试成功后收敛展示牌与暗牌且清理状态', () => {
    const { controller, room } = setup()
    controller.syncTrackerMove(protocolMove({ CardIDs: [11, 12], ToID: 1 }))
    controller.dispatchSkillProtocolEvent({
      type: 'targetNotice',
      message: { SpellID: 361, Param: 0, Type: 29, targetSeatID: 1, Params: [11] }
    })
    controller.dispatchSkillProtocolEvent({
      type: 'choice',
      message: { SpellID: 361, Type: 22, data_count: 2, SeatID: 2, Datas: [2, 1] }
    })
    const move = protocolMove({
      SpellID: 361,
      FromZone: 5,
      FromID: 1,
      ToID: 2,
      CardIDs: [],
      CardCount: 1,
      MoveType: 5
    })
    vi.spyOn(room, 'moveCards').mockReturnValueOnce(false)
    controller.syncTrackerMove(move)
    expect(hasSkillState(room, 361)).toBe(true)
    expect(room.getPlayer(1)!.observedHandCount).toBe(2)
    controller.syncTrackerMove(move)
    expect(room.cardIndex.get(11)!.owner).toBe(1)
    expect(room.cardIndex.get(12)!.owner).toBe(2)
    expect(hasSkillState(room, 361)).toBe(false)
    expect(room.getPlayer(1)!.observedHandCount).toBe(1)
    expect(room.getPlayer(2)!.observedHandCount).toBe(1)
  })
})
