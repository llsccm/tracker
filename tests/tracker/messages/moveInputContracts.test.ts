import { getMovePosition, getMoveSeat, getMoveZone } from '@/tracker/helper/moveEndpoint'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import { summarizeMoveEvent } from '@/tracker/helper/moveSummary'
import { patchEvent } from '@/tracker/skill/moveEventUtils'
import type { Room } from '@/tracker/Room'
import type { CardID, NormalizedMoveEvent, RawMoveCardEvent } from '@/tracker/types'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { protocolMove, createReadyControllerHarness } from '../helpers/trackerController'

describe('移动输入的只读直传契约', () => {
  it('Room 只接收只读 ID 数组，标准事件协议保持完整', () => {
    expectTypeOf<Parameters<Room['moveCards']>[0]>().toEqualTypeOf<readonly CardID[]>()
    expectTypeOf<NormalizedMoveEvent['protocol']>().toEqualTypeOf<Readonly<RawMoveCardEvent>>()
    expectTypeOf<NormalizedMoveEvent['cardIDs']>().toEqualTypeOf<readonly CardID[]>()
  })

  it('归一化和装饰保留协议来源，不修改只读输入', () => {
    const raw = Object.freeze(
      protocolMove({
        CardIDs: Object.freeze([0]),
        FromPosition: POSITION_RANDOM
      })
    )
    const patched = Object.freeze({
      ...raw,
      CardIDs: Object.freeze([96]),
      FromPosition: POSITION_TOP
    })

    const event = normalizeMoveEvent(patched, raw)
    const decorated = patchEvent(event, { cardIDs: [113] })

    expect(event.type).toBe('drawKnown')
    expect(event.protocol).toEqual(patched)
    expect(event.cardIDs).toEqual([96])
    expect(event.raw).toEqual(raw)
    expect(event.options.sourceEvent?.raw).toEqual(raw)
    expect(getMovePosition(event.from)).toBe(POSITION_TOP)
    expect(decorated.cardIDs).toEqual([113])
    expect(decorated.protocol).toEqual(patched)
    expect(decorated.raw).toEqual(raw)
    expect(patched.CardIDs).toEqual([96])
    expect(raw.CardIDs).toEqual([0])
  })

  it('明牌与匿名牌移动不修改输入数组，按协议张数更新手牌和牌堆', () => {
    const { controller, room } = createReadyControllerHarness({
      players: [{ SeatID: 0, ClientID: 100 }, { SeatID: 1 }],
      cardIDs: [1, 2, 3]
    })
    controller.setTrackerFirstHand(0)
    const knownIDs = Object.freeze([1])
    const hiddenIDs = Object.freeze([] as CardID[])

    expect(
      room.moveCards(knownIDs, {
        from: { type: 'public', zone: 'pile', position: POSITION_TOP },
        to: { type: 'player', seatID: 1, subZone: 'hand' },
        cardCount: 1
      })
    ).toBe(true)
    expect(
      room.moveCards(hiddenIDs, {
        from: { type: 'public', zone: 'pile', position: POSITION_TOP },
        to: { type: 'player', seatID: 1, subZone: 'hand' },
        cardCount: 1
      })
    ).toBe(true)

    expect(knownIDs).toEqual([1])
    expect(hiddenIDs).toEqual([])
    expect(room.getPlayer(1)?.observedHandCount).toBe(2)
    expect(room.zones.get('pile')?.cards).toHaveLength(1)
    controller.destroyTrackerRoom()
  })
  it.each([0, 7])('目标玩家 %s 在事件与摘要中都使用 toSeatID', (toSeatID) => {
    const event = normalizeMoveEvent(protocolMove({ ToID: toSeatID }))
    const summary = summarizeMoveEvent(event)

    expect(getMoveSeat(event.to)).toBe(toSeatID)
    expect(getMoveSeat(summary.to)).toBe(toSeatID)
    expect(event.options).not.toHaveProperty('seatID')
    expect(summary.options).not.toHaveProperty('seatID')
  })

  it('手牌使用到处理区保留来源座位，公共区不设置目标玩家', () => {
    const event = normalizeMoveEvent(
      protocolMove({
        CardIDs: [107],
        CardCount: 1,
        FromID: 7,
        FromZone: 5,
        FromPosition: 65282,
        ToID: 255,
        ToZone: 3,
        ToPosition: 65280,
        MoveType: 2,
        SpellID: 0
      })
    )

    expect(getMoveZone(event.to)).toBe('process')
    expect(getMoveSeat(event.from)).toBe(7)
    expect(getMoveSeat(event.to)).toBeNull()
    expect(event.options).not.toHaveProperty('seatID')
    expect(summarizeMoveEvent(event).options).not.toHaveProperty('seatID')
  })

  it('Room 移动和技能回调统一传递 toSeatID', () => {
    const { controller, room } = createReadyControllerHarness({
      players: [{ SeatID: 0, ClientID: 100 }, { SeatID: 1 }],
      cardIDs: [1, 2]
    })
    const handler = vi.fn()
    room.registerSkillHandler(42, handler)

    room.moveCards([1], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 1, subZone: 'hand' },
      triggerSpellID: 42
    })

    expect(controller.getTrackedPlayerHandCardIDs(1)).toEqual([1])
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][1]).toMatchObject({
      to: { type: 'player', seatID: 1, subZone: 'hand' }
    })
    expect(handler.mock.calls[0][1]).not.toHaveProperty('seatID')
    controller.destroyTrackerRoom()
  })

  it('揭示 API 仍使用 seatID，但传给 Room 的移动参数使用 toSeatID', () => {
    const { controller, room } = createReadyControllerHarness({
      players: [{ SeatID: 0, ClientID: 100 }, { SeatID: 1 }],
      cardIDs: [1, 2]
    })
    const moveCards = vi.spyOn(room, 'moveCards')

    controller.revealTrackerCards({ type: 'player', seatID: 1, fromZone: 'pile' }, [1])

    expect(moveCards).toHaveBeenCalledOnce()
    expect(moveCards.mock.calls[0][1]).toMatchObject({
      to: { type: 'player', seatID: 1, subZone: 'hand' }
    })
    expect(moveCards.mock.calls[0][1]).not.toHaveProperty('seatID')
    expect(controller.getTrackedPlayerHandCardIDs(1)).toEqual([1])
    controller.destroyTrackerRoom()
  })
})
