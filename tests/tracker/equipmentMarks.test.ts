import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getEquipmentMarkRecordKey,
  getEquipmentMarkSeatChange,
  getObservedEquipmentMarkSnapshot,
  resolveEquipmentContainerLocationCandidates
} from '@/tracker/room/movement/equipmentMarks'
import { HIDDEN_MARK_STATE_KEY, type HiddenMarkState } from '@/tracker/room/movement/types'
import type { Room } from '@/tracker/Room'
import type { CardID, RoomMoveRequest } from '@/tracker/types'
import { collectTraversalStats } from '@/tracker/traversalStats'
import { createTestRoom, getCard, takeAnonymousCard } from './helpers/room'
import { equipmentContainer, playerLocation } from './helpers/locationCandidates'

afterEach(() => vi.restoreAllMocks())

function createMarkContext(
  room: Room,
  cardIDs: readonly CardID[] = [],
  options: Partial<RoomMoveRequest> = {}
) {
  return room.movement.createMoveContext(cardIDs, {
    from: { type: 'player', seatID: 0, subZone: 'mark', markSpellID: 700 },
    to: { type: 'player', seatID: 6, subZone: 'mark', markSpellID: 700 },
    cardCount: 2,
    ...options
  })
}

describe('装备标记容器只读规则', () => {
  it.each([
    { observedSeat: undefined, expectedSeat: 6 },
    { observedSeat: null, expectedSeat: 6 },
    { observedSeat: 0, expectedSeat: 0 }
  ])(
    '座位观测 $observedSeat 对应标记座位 $expectedSeat，查询不写状态',
    ({ observedSeat, expectedSeat }) => {
      const { room } = createTestRoom({ cardIDs: [161], seatIDs: [0, 6] })
      room.moveCards([161], {
        from: { type: 'public', zone: 'pile', position: POSITION_TOP },
        to: { type: 'player', seatID: 6, subZone: 'equip' },
        triggerSpellID: 700,
        cardCount: 1
      })

      expect(
        resolveEquipmentContainerLocationCandidates(
          equipmentContainer(161, 700),
          room.cardIndex,
          observedSeat
        )
      ).toEqual([playerLocation(expectedSeat, 'mark', 700)])
      expect(room.cardIndex.get(161)!.seats).toEqual(new Set([6]))
      expect(room.readSkillState(HIDDEN_MARK_STATE_KEY)).toBeUndefined()
    }
  )

  it('装备离开装备区后，旧空间观测不能继续产生标记投影', () => {
    const { room } = createTestRoom({ cardIDs: [161], seatIDs: [0, 6] })
    room.moveCards([161], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'public', zone: 'discard', position: POSITION_TOP },
      cardCount: 1
    })

    expect(
      resolveEquipmentContainerLocationCandidates(equipmentContainer(161, 700), room.cardIndex, 0)
    ).toEqual([])
    expect(room.cardIndex.get(161)!.location).toBe('discard')
    expect(room.readSkillState(HIDDEN_MARK_STATE_KEY)).toBeUndefined()
  })

  it('装备记录键按来源区分且不含承载座位，普通标记交回通用流程', () => {
    expect(getEquipmentMarkRecordKey(0, 700)).toBe('0:muniu:161')
    expect(getEquipmentMarkRecordKey(6, 700)).toBe('6:muniu:161')
    expect(getEquipmentMarkRecordKey(0, 414)).toBeNull()
    expect(getEquipmentMarkRecordKey(0, null)).toBeNull()
  })

  it.each([
    { name: '同空间跨座', options: {}, transferFromSeat: 0 },
    {
      name: '手牌放入容器',
      options: { from: { type: 'player', seatID: 0, subZone: 'hand' } },
      transferFromSeat: null
    },
    {
      name: '同座位通知',
      options: { from: { type: 'player', seatID: 6, subZone: 'mark', markSpellID: 700 } },
      transferFromSeat: null
    },
    {
      name: '不同来源标记',
      options: { from: { type: 'player', seatID: 0, subZone: 'mark', markSpellID: 414 } },
      transferFromSeat: null
    }
  ] as const)('$name 区分目标观测与实际迁移，规则不修改上下文', ({ options, transferFromSeat }) => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [0, 6] })
    const context = Object.freeze(createMarkContext(room, [], options))

    expect(getEquipmentMarkSeatChange(context)).toEqual({
      markSpellID: 700,
      targetSeat: 6,
      transferFromSeat
    })
    expect(context.skipUnknownMovement).toBe(false)
    expect(room.readSkillState(HIDDEN_MARK_STATE_KEY)).toBeUndefined()
  })

  it('装备本体、普通标记、多目标与来源标记不匹配不被识别为同一容器目标', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [0, 6] })
    expect(
      getEquipmentMarkSeatChange(
        createMarkContext(room, [], { to: { type: 'player', seatID: 6, subZone: 'equip' } })
      )
    ).toBeNull()
    expect(
      getEquipmentMarkSeatChange(
        createMarkContext(room, [], {
          to: { type: 'player', seatID: 6, subZone: 'mark', markSpellID: 414 }
        })
      )
    ).toBeNull()
    expect(
      getEquipmentMarkSeatChange(
        createMarkContext(room, [], {
          to: { type: 'playerCandidates', seatIDs: [0, 6], subZone: 'mark', markSpellID: 700 }
        })
      )
    ).toBeNull()
    expect(getEquipmentMarkSeatChange(createMarkContext(room), 414)).toBeNull()
    expect(room.readSkillState(HIDDEN_MARK_STATE_KEY)).toBeUndefined()
  })

  it('只识别完整可见快照，空 CardIDs 的暗迁座和部分揭示均不构成快照', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [0, 6] })
    expect(getObservedEquipmentMarkSnapshot(createMarkContext(room, [1, 2]))).toEqual({
      markSpellID: 700,
      observedSeat: 6
    })
    expect(getObservedEquipmentMarkSnapshot(createMarkContext(room))).toBeNull()
    expect(getObservedEquipmentMarkSnapshot(createMarkContext(room, [1, 0]))).toBeNull()
    expect(
      getObservedEquipmentMarkSnapshot(
        createMarkContext(room, [1, 2], { from: { type: 'player', seatID: 0, subZone: 'hand' } })
      )
    ).toBeNull()
    expect(
      getObservedEquipmentMarkSnapshot(
        createMarkContext(room, [1, 2], {
          from: { type: 'player', seatID: 0, subZone: 'mark', markSpellID: null }
        })
      )
    ).toBeNull()
    expect(room.readSkillState(HIDDEN_MARK_STATE_KEY)).toBeUndefined()
  })

  it('零张通知不创建账本，普通暗置仅由协调层写入观测而不接管空间迁移', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [0, 6] })
    const zeroCount = createMarkContext(room, [], { cardCount: 0 })
    expect(room.movement.hiddenMarks.handleMuniuMarkMove(zeroCount)).toBe(false)
    expect(zeroCount.skipUnknownMovement).toBe(false)
    expect(room.readSkillState(HIDDEN_MARK_STATE_KEY)).toBeUndefined()

    const putIntoContainer = createMarkContext(room, [], {
      from: { type: 'player', seatID: 0, subZone: 'hand' }
    })
    expect(room.movement.hiddenMarks.handleMuniuMarkMove(putIntoContainer)).toBe(false)
    expect(putIntoContainer.skipUnknownMovement).toBe(false)
    const state = room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
    expect(state.muniuMarkSeat).toBe(6)
    expect(state.records.size).toBe(0)
  })

  it('迁座增量读取刚进入玩家区的明暗标记，不扫描全牌池或迁移其他标记', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4], seatIDs: [0, 6] })
    const known = getCard(room, 1)!
    const unknown = takeAnonymousCard(room)
    const otherMark = getCard(room, 3)!
    room.clearCardsFromPublicZones([known, unknown, otherMark])
    known.bindCandidates([0], 'mark', 700, { known: true })
    unknown.bindCandidates([0], 'mark', 700)
    otherMark.bindCandidates([0], 'mark', 414, { known: true })
    const context = createMarkContext(room)
    const forEach = vi.spyOn(room.cards, 'forEach')

    const { result, stats } = collectTraversalStats(() =>
      room.movement.hiddenMarks.handleMuniuMarkMove(context)
    )

    expect(result).toBe(true)
    expect(context.skipUnknownMovement).toBe(true)
    expect(known.seats).toEqual(new Set([6]))
    expect(unknown.seats).toEqual(new Set([6]))
    expect(known.isKnown).toBe(true)
    expect(unknown.isKnown).toBe(false)
    expect(otherMark.seats).toEqual(new Set([0]))
    expect(forEach).not.toHaveBeenCalled()
    expect(stats.sites.get('resolveConstraints:playerSnapshot')).toBeUndefined()
  })
})
