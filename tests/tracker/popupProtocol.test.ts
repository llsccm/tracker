import { getMoveSeat, getMoveSubZone, getPopupSpaceID } from '@/tracker/helper/moveEndpoint'
import { describe, expect, it } from 'vitest'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import { getPopupSpaceCards } from '@/tracker/room/movement/popupSpaces'
import { getUnknownPlayerSourceCards } from '@/tracker/room/movement/sourceQueries'
import { protocolMove, createReadyControllerHarness } from './helpers/trackerController'

function setup(ids: number[]) {
  const { controller } = createReadyControllerHarness({
    seatIDs: [6, 3],
    currentUserID: 600,
    cardIDs: ids
  })
  return { controller, room: controller.getTrackerRoom()! }
}

describe('玩家标记与弹窗协议边界', () => {
  it('同技能玩家标记与弹窗隔离，集运 3658 暗交按 3657 来源空间收敛', () => {
    const { controller, room } = setup([43, 40, 96, 37])
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 3,
        CardIDs: [43, 40, 96],
        FromZone: 1,
        FromID: 255,
        ToZone: 4,
        ToID: 6,
        ToZoneParam: 3657,
        MoveType: 15,
        SpellID: 3657
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [37],
        FromZone: 1,
        FromID: 255,
        ToZone: 8,
        ToID: 255,
        MoveType: 6,
        SpellID: 3657
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [],
        FromZone: 4,
        FromID: 6,
        FromZoneParam: 3657,
        ToZone: 5,
        ToID: 3,
        MoveType: 27,
        SpellID: 3658
      })
    )
    expect(
      room
        .getPlayer(3)!
        .candidateHandCards.map((card) => card.id)
        .sort((a, b) => a - b)
    ).toEqual([40, 43, 96])
    expect(room.getPlayer(3)!.getCandidateHandSlotCount()).toBe(1)
    expect(getPopupSpaceCards(room, 3657).map((card) => card.id)).toEqual([37])
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [96],
        FromZone: 5,
        FromID: 3,
        ToZone: 2,
        ToID: 255,
        MoveType: 4,
        SpellID: 0
      })
    )
    expect(
      room
        .getPlayer(6)!
        .markCards.get(3657)!
        .map((card) => card.id)
        .sort((a, b) => a - b)
    ).toEqual([40, 43])
    expect(room.getPlayer(3)!.observedHandCount).toBe(0)
    expect(getPopupSpaceCards(room, 3657).map((card) => card.id)).toEqual([37])
    expect(room.cards).toHaveLength(4)
  })

  it('区域 8 的空间 ID 不进入座位字段，区域 4 按 ZoneParam 读取来源', () => {
    const popup = normalizeMoveEvent(
      protocolMove({
        FromZone: 8,
        FromID: 35,
        ToZone: 1,
        ToID: 255,
        SpellID: 35,
        MoveType: 7
      })
    )
    expect(popup.from).toEqual({ type: 'popup', spaceID: 35 })
    expect(getMoveSeat(popup.from)).toBeNull()
    expect(getMoveSubZone(popup.from)).toBeUndefined()
    const mark = normalizeMoveEvent(
      protocolMove({
        FromZone: 4,
        FromID: 6,
        FromZoneParam: 414,
        ToZone: 5,
        ToID: 6,
        SpellID: 3389,
        MoveType: 15
      })
    )
    expect(mark.from).toEqual({ type: 'player', seatID: 6, subZone: 'mark', markSpellID: 414 })
    expect(getPopupSpaceID(mark.from)).toBeUndefined()
  })

  it('技能 35 暂存五张、四张回顶一张回底，复用原槽并释放空间', () => {
    const { controller, room } = setup([1, 2, 3, 4, 5, 6, 7])
    const before = [...room.zones.get('pile')!.cards]
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 5,
        CardIDs: [],
        FromID: 255,
        FromPosition: 65280,
        FromZone: 1,
        MoveType: 6,
        SpellID: 35,
        ToID: 255,
        ToPosition: 65280,
        ToZone: 8
      })
    )
    const slots = [...getPopupSpaceCards(room, 35)]
    expect(slots).toHaveLength(5)
    expect(
      slots.every(
        (card) => card.location === 'popup' && card.subZone === null && card.owner === null
      )
    ).toBe(true)
    expect(room.zones.get('pile')!.cards).toHaveLength(2)
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 4,
        CardIDs: [],
        FromID: 35,
        FromPosition: 65282,
        FromZone: 8,
        MoveType: 7,
        SpellID: 35,
        ToID: 255,
        ToPosition: 65280,
        ToZone: 1
      })
    )
    const remaining = getPopupSpaceCards(room, 35)[0]
    expect(getPopupSpaceCards(room, 35)).toHaveLength(1)
    expect(room.zones.get('pile')!.cards.slice(0, 2)).toEqual(before.slice(0, 2))
    expect(new Set(room.zones.get('pile')!.cards.slice(-4))).toEqual(
      new Set(slots.filter((card) => card !== remaining))
    )
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [],
        FromID: 35,
        FromPosition: 65282,
        FromZone: 8,
        MoveType: 7,
        SpellID: 35,
        ToID: 255,
        ToPosition: 0,
        ToZone: 1
      })
    )
    expect(room.zones.get('pile')!.cards[0]).toBe(remaining)
    expect(new Set(room.zones.get('pile')!.cards)).toEqual(new Set(before))
    expect(room.cards).toHaveLength(7)
    expect(room.hasSkillState('popupSpaces')).toBe(false)
    expect(room.assertPileIdentityLedgerConsistency('popup:35')).toEqual([])
  })

  it('414 混合装备与暗手牌整区返回，3389 不作为来源空间别名', () => {
    const { controller, room } = setup([136, 137, 138, 139])
    controller.syncTrackerMove(protocolMove({ CardIDs: [136], ToID: 6, ToZone: 6 }))
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 3, ToID: 6, ToZone: 5 }))
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [136],
        FromID: 6,
        FromZone: 6,
        MoveType: 15,
        SpellID: 414,
        ToID: 6,
        ToZone: 4,
        ToZoneParam: 414
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 3,
        FromID: 6,
        FromZone: 5,
        MoveType: 15,
        SpellID: 414,
        ToID: 6,
        ToZone: 4,
        ToZoneParam: 414
      })
    )
    expect(getUnknownPlayerSourceCards(room, 6, 'mark', 3389)).toEqual([])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromID: 6,
        FromZone: 4,
        FromZoneParam: 414,
        MoveType: 15,
        SpellID: 3389,
        ToID: 6,
        ToZone: 5
      })
    )
    expect(room.getPlayer(6)!.observedHandCount).toBe(4)
    expect(room.cardIndex.get(136)!.getPossibleLocations()).toEqual([
      { type: 'player', seatID: 6, subZone: 'hand', spellID: null }
    ])
    expect(room.getPlayer(6)!.markCards.size).toBe(0)
    expect(room.cards).toHaveLength(4)
  })

  it('弹窗按空间原地揭示，不创建玩家也不增加物理数量', () => {
    const { controller, room } = setup([37, 92])
    controller.syncTrackerMove(
      protocolMove({ CardIDs: [], CardCount: 2, ToZone: 8, ToID: 255, SpellID: 3544 })
    )
    const slots = [...getPopupSpaceCards(room, 3544)]
    controller.revealTrackerCardsInZone({ zone: 8, id: 3544 }, [37, 92])
    expect(new Set(getPopupSpaceCards(room, 3544))).toEqual(new Set(slots))
    expect(getPopupSpaceCards(room, 3544).map((card) => card.id)).toEqual([37, 92])
    expect(room.cards).toHaveLength(2)
    expect(room.getPlayer(3544)).toBeUndefined()
    expect(room.assertPileIdentityLedgerConsistency('popup:reveal')).toEqual([])
  })
})
