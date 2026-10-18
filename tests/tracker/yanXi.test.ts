import { describe, expect, it } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { normalizeMoveEvent } from '@/tracker/MoveEventNormalizer'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type { RawMoveCardEvent } from '@/tracker/types'
import {
  createErrorSpy,
  createTrackerControllerHarness,
  protocolMove
} from './helpers/trackerController'

function setupYanXi(topIDs: number[] = [1, 2, 3], isGuoZhan = false) {
  const errorSpy = createErrorSpy()
  const { controller, gameState } = createTrackerControllerHarness()
  controller.initTrackerRoom()
  controller.registerTrackerPlayers(
    [1, 4, 7].map((seat) => ({ SeatID: seat, ClientID: seat })),
    1
  )
  controller.initTrackerDeck(Array.from({ length: 20 }, (_, index) => index + 1))
  controller.syncTrackerMove(protocolMove({ ToID: 4, CardIDs: [19] }))
  if (topIDs.length > 0) {
    controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, topIDs)
  }
  gameState.isGuoZhan = isGuoZhan
  const room = controller.getTrackerRoom()!
  return { controller, room, gameState, errorSpy }
}

function yanXiMove(fields: Partial<RawMoveCardEvent> = {}) {
  return protocolMove({
    CardIDs: [],
    CardCount: 1,
    FromID: 255,
    FromZone: 1,
    FromPosition: POSITION_RANDOM,
    ToID: 7,
    ToZone: 5,
    ToPosition: POSITION_TOP,
    MoveType: 8,
    SpellID: 7017,
    ...fields
  })
}

function successMarker(toID = 7) {
  return yanXiMove({ FromID: 4, FromZone: 5, ToID: toID, CardIDs: [19] })
}

describe('宴戏成功批次与暗牌失败降级', () => {
  it.each([{ topIDs: [] }, { topIDs: [1] }, { topIDs: [1, 2] }, { topIDs: [1, 2, 3] }])(
    '非国战成功时依次取得原牌顶两张，端点明牌 $topIDs 不会被跳过',
    ({ topIDs }) => {
      const { controller, room, errorSpy } = setupYanXi(topIDs)
      const pile = room.zones.get('pile')!
      const originalTop = pile.cards.slice(-2).reverse()
      const remainingPile = pile.cards.slice(0, -2)
      const entityCount = room.cards.length
      controller.syncTrackerMove(successMarker())
      const moves = [yanXiMove(), yanXiMove()]

      moves.forEach((move, index) => {
        controller.syncTrackerMove(move)
        expect(originalTop[index].location).toBe('player')
        expect(originalTop[index].seats.has(7)).toBe(true)
        expect(room.assertPileIdentityLedgerConsistency('yanxi:success')).toEqual([])
        expect(move.FromPosition).toBe(POSITION_RANDOM)
        expect(move.CardIDs).toEqual([])
      })

      expect(pile.cards).toEqual(remainingPile)
      expect(room.getPlayer(7)!.observedHandCount).toBe(3)
      expect(room.cards).toHaveLength(entityCount)
      expect(room.hasSkillState(7017)).toBe(false)
      topIDs.slice(0, 2).forEach((id) => {
        expect(room.getPlayerHandCardIDs(7)).toContain(id)
        expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).not.toContain(id)
      })
      expect(errorSpy).not.toHaveBeenCalled()
    }
  )

  it('成功分支优先使用协议公开的 ID，不改写原消息', () => {
    const { controller, room, errorSpy } = setupYanXi([])
    const pileCount = room.zones.get('pile')!.cards.length
    controller.syncTrackerMove(successMarker())
    const first = yanXiMove({ CardIDs: [1] })
    const second = yanXiMove({ CardIDs: [2] })
    controller.syncTrackerMove(first)
    controller.syncTrackerMove(second)

    expect(room.getPlayerHandCardIDs(7)).toEqual(expect.arrayContaining([19, 1, 2]))
    expect(room.zones.get('pile')!.cards).toHaveLength(pileCount - 2)
    expect(first.CardIDs).toEqual([1])
    expect(first.FromPosition).toBe(POSITION_RANDOM)
    expect(room.hasSkillState(7017)).toBe(false)
    expect(room.assertPileIdentityLedgerConsistency('yanxi:known-success')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it.each([{ cardIDs: [] }, { cardIDs: [0] }])(
    '失败且无真实 ID $cardIDs 时仅匿名化原前两槽，不影响原第三张',
    ({ cardIDs }) => {
      const { controller, room, errorSpy } = setupYanXi()
      const pile = room.zones.get('pile')!
      const top = pile.cards.slice(-2)
      const third = pile.cards.at(-3)!
      const pileCount = pile.cards.length
      const entityCount = room.cards.length

      controller.syncTrackerMove(yanXiMove({ CardIDs: cardIDs }))

      expect(top.every(isAnonymous)).toBe(true)
      expect(room.cardIndex.has(1)).toBe(false)
      expect(room.cardIndex.has(2)).toBe(false)
      expect(room.unlocatedIdentities.has(1)).toBe(true)
      expect(room.unlocatedIdentities.has(2)).toBe(true)
      expect(room.cardIndex.get(3)).toBe(third)
      expect(third.isKnown).toBe(true)
      expect(third.location).toBe('pile')
      expect(pile.cards).toHaveLength(pileCount - 1)
      expect(room.getPlayer(7)!.observedHandCount).toBe(1)
      expect(room.getPlayerHandCardIDs(7)).toEqual([])
      expect(room.cards).toHaveLength(entityCount)
      expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([3])
      expect(room.assertPileIdentityLedgerConsistency('yanxi:hidden-failure')).toEqual([])
      expect(errorSpy).not.toHaveBeenCalled()
    }
  )

  it('前两槽仅一张明牌时不向更深处寻找第二张明牌', () => {
    const { controller, room, errorSpy } = setupYanXi()
    const pile = room.zones.get('pile')!
    const first = pile.cards.at(-1)!
    const third = pile.cards.at(-3)!
    // 先取得原第二张，再随机回堆，构造“暗、明、明”的牌顶。
    controller.syncTrackerMove(protocolMove({ ToID: 1, CardIDs: [2] }))
    controller.syncTrackerMove(
      protocolMove({
        FromID: 1,
        FromZone: 5,
        ToID: 255,
        ToZone: 1,
        CardIDs: [2],
        MoveType: 19,
        ToPosition: POSITION_RANDOM
      })
    )
    // 随机回堆的匿名槽在最顶，原第一张在第二槽，第三张在范围之外。
    expect(pile.cards.at(-2)).toBe(first)
    expect(pile.cards.at(-3)).toBe(third)

    controller.syncTrackerMove(yanXiMove())

    expect(isAnonymous(first)).toBe(true)
    expect(third.id).toBe(3)
    expect(third.isKnown).toBe(true)
    expect(room.assertPileIdentityLedgerConsistency('yanxi:one-known')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it.each([1, 7])('失败但公开 CardID 时不因观察者座位 %s 清除其他明牌', (mySeat) => {
    const { controller, room, errorSpy } = setupYanXi()
    room.setMySeatID(mySeat)
    const top = room.cardIndex.get(1)!
    const third = room.cardIndex.get(3)!
    controller.syncTrackerMove(yanXiMove({ CardIDs: [2] }))

    expect(room.getPlayerHandCardIDs(7)).toContain(2)
    expect(top.location).toBe('pile')
    expect(top.isKnown).toBe(true)
    expect(third.isKnown).toBe(true)
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([1, 3])
    expect(room.assertPileIdentityLedgerConsistency('yanxi:known-failure')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('国战成功批次保持随机暗牌获得，不取走或匿名化牌顶明牌', () => {
    const { controller, room, errorSpy } = setupYanXi([1, 2, 3], true)
    const top = room.zones.get('pile')!.cards.slice(-3)
    const pileCount = room.zones.get('pile')!.cards.length
    controller.syncTrackerMove(successMarker())
    controller.syncTrackerMove(yanXiMove())
    controller.syncTrackerMove(yanXiMove())

    expect(room.zones.get('pile')!.cards.slice(-3)).toEqual(top)
    expect(top.every((card) => card.isKnown)).toBe(true)
    expect(room.getPlayerHandCardIDs(7)).toEqual([19])
    expect(room.getPlayer(7)!.observedHandCount).toBe(3)
    expect(room.zones.get('pile')!.cards).toHaveLength(pileCount - 2)
    expect(room.hasSkillState(7017)).toBe(false)
    expect(room.assertPileIdentityLedgerConsistency('yanxi:guozhan-success')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('国战成功的明牌协议仍精确获得指定 ID，不影响其他牌顶明牌', () => {
    const { controller, room, errorSpy } = setupYanXi([1, 2, 3], true)
    controller.syncTrackerMove(successMarker())
    controller.syncTrackerMove(yanXiMove({ CardIDs: [8] }))
    controller.syncTrackerMove(yanXiMove({ CardIDs: [9] }))

    expect(room.getPlayerHandCardIDs(7)).toEqual(expect.arrayContaining([19, 8, 9]))
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([1, 2, 3])
    expect(room.hasSkillState(7017)).toBe(false)
    expect(room.assertPileIdentityLedgerConsistency('yanxi:guozhan-known')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('成功额度耗尽后下一次暗牌获得按失败处理', () => {
    const { controller, room } = setupYanXi([1, 2, 3, 4, 5])
    controller.syncTrackerMove(successMarker())
    controller.syncTrackerMove(yanXiMove())
    controller.syncTrackerMove(yanXiMove())
    controller.syncTrackerMove(yanXiMove())

    expect(room.getPlayerHandCardIDs(7)).toEqual(expect.arrayContaining([19, 1, 2]))
    expect(room.cardIndex.has(3)).toBe(false)
    expect(room.cardIndex.has(4)).toBe(false)
    expect(room.cardIndex.get(5)!.isKnown).toBe(true)
    expect(room.assertPileIdentityLedgerConsistency('yanxi:next-failure')).toEqual([])
  })

  it('新的成功标记替换旧批次，Room 销毁后不保留状态', () => {
    const { room, gameState } = setupYanXi()
    room.decorateMoveEvent(normalizeMoveEvent(successMarker()))
    room.decorateMoveEvent(normalizeMoveEvent(successMarker(1)))
    const next = room.decorateMoveEvent(normalizeMoveEvent(yanXiMove({ ToID: 1 })))
    expect(next.options.fromPosition).toBe(POSITION_TOP)
    expect(room.readSkillState(7017)).toMatchObject({ toSeatID: 1, remainingPileCards: 1 })
    room.destroy()
    expect(gameState.hasState('tracker', 7017)).toBe(false)
  })
})
