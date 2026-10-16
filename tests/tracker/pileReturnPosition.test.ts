import { describe, expect, it, vi } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { normalizeTrackerMovePosition } from '@/tracker/runtime/protocolRules'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

function createHarness() {
  const onError = vi.fn()
  const { controller } = createTrackerControllerHarness({ onError })
  controller.initTrackerRoom()
  controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
  controller.initTrackerDeck([17, 18, 19])
  const room = controller.getTrackerRoom()!
  return { controller, room, pile: room.zones.get('pile')!, onError }
}

describe('回堆位置与匿名身份', () => {
  it.each([{ cardIDs: [] }, { cardIDs: [17] }])('手气卡只需入口位置修正（%j）', ({ cardIDs }) => {
    const { controller, room, pile, onError } = createHarness()
    controller.syncTrackerMove(protocolMove({ CardIDs: cardIDs, CardCount: 1 }))
    const raw = protocolMove({
      CardIDs: cardIDs,
      CardCount: 1,
      FromID: 1,
      FromZone: 5,
      ToID: 255,
      ToZone: 1,
      ToPosition: POSITION_TOP,
      MoveType: 19,
      SpellID: 0
    })
    const patched = { ...raw, ...normalizeTrackerMovePosition(raw) }
    expect(patched.ToPosition).toBe(POSITION_RANDOM)
    controller.syncTrackerMove(patched, raw)

    expect(pile.cards).toHaveLength(3)
    expect(pile.cards.every((card) => isAnonymous(card) && !card.isKnown)).toBe(true)
    expect(room.getPlayer(1)!.cards).toHaveLength(0)
    expect(room.cardIndex.has(17)).toBe(false)
    expect(room.assertPileIdentityLedgerConsistency('test:shouqi-random-return')).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })

  it('牌堆内真实随机重插也匿名化，但不增加物理张数', () => {
    const { controller, room, pile, onError } = createHarness()
    controller.revealTrackerCards({ type: 'public', zoneName: 'pile' }, [17])
    const card = room.cardIndex.get(17)!
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [17],
        ToID: 255,
        ToZone: 1,
        ToPosition: POSITION_RANDOM,
        MoveType: 15,
        SpellID: 4567
      })
    )

    expect(pile.cards).toHaveLength(3)
    expect(isAnonymous(card)).toBe(true)
    expect(room.cardIndex.has(17)).toBe(false)
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([])
    expect(room.assertPileIdentityLedgerConsistency('test:random-pile-reinsert')).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([2, 5, 11])('普通技能从 %i 区随机回堆，无需额外匿名化选项', (fromZone) => {
    const { controller, room, pile, onError } = createHarness()
    controller.syncTrackerMove(protocolMove({ CardIDs: [17], ToZone: fromZone }))
    const returnedCard = room.cardIndex.get(17)!
    const otherCards = [...pile.cards]

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [17],
        FromID: fromZone === 5 ? 1 : 255,
        FromZone: fromZone,
        FromPosition: POSITION_RANDOM,
        ToID: 255,
        ToZone: 1,
        ToPosition: POSITION_RANDOM,
        MoveType: 15,
        SpellID: 4567
      })
    )

    expect(pile.cards).toHaveLength(3)
    expect(pile.cards).toContain(returnedCard)
    expect(pile.cards.filter((card) => card !== returnedCard)).toEqual(otherCards)
    expect(pile.cards.every((card) => isAnonymous(card) && !card.isKnown)).toBe(true)
    expect(room.cardIndex.has(17)).toBe(false)
    expect(room.unlocatedIdentities.has(17)).toBe(true)
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([])
    expect(room.assertPileIdentityLedgerConsistency('test:generic-random-return')).toEqual([])

    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))
    expect(room.getPlayer(1)!.cards.every(isAnonymous)).toBe(true)
    expect(room.cardIndex.has(17)).toBe(false)
    expect(room.assertPileIdentityLedgerConsistency('test:random-return-draw')).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })

  it('无 CardIDs 的随机回堆也匿名化实际取到的已知弃牌实体', () => {
    const { controller, room, pile, onError } = createHarness()
    controller.syncTrackerMove(protocolMove({ CardIDs: [17], ToZone: 2 }))
    const returnedCard = room.cardIndex.get(17)!

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 2,
        FromPosition: POSITION_TOP,
        ToID: 255,
        ToZone: 1,
        ToPosition: POSITION_RANDOM,
        MoveType: 15,
        SpellID: 4567
      })
    )

    expect(pile.cards).toContain(returnedCard)
    expect(isAnonymous(returnedCard)).toBe(true)
    expect(room.cardIndex.has(17)).toBe(false)
    expect(room.unlocatedIdentities.has(17)).toBe(true)
    expect(room.assertPileIdentityLedgerConsistency('test:inferred-random-return')).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([POSITION_BOTTOM, POSITION_TOP, 1])(
    '来源随机但目标精确为 %i 时保留实体身份',
    (position) => {
      const { controller, room, pile, onError } = createHarness()
      controller.syncTrackerMove(protocolMove({ CardIDs: [17], ToZone: 2 }))
      const returnedCard = room.cardIndex.get(17)!

      controller.syncTrackerMove(
        protocolMove({
          CardCount: 1,
          CardIDs: [17],
          FromID: 255,
          FromPosition: POSITION_RANDOM,
          FromZone: 2,
          FromZoneParam: 0,
          MoveType: 15,
          SpellID: 3543,
          ToID: 255,
          ToPosition: position,
          ToZone: 1,
          ToZoneParam: 0
        })
      )

      expect(pile.cards[position === POSITION_TOP ? 2 : position]).toBe(returnedCard)
      expect(returnedCard).toMatchObject({ id: 17, location: 'pile', isKnown: true })
      expect(room.cardIndex.get(17)).toBe(returnedCard)
      expect(room.unlocatedIdentities.has(17)).toBe(false)
      expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([17])
      expect(room.assertPileIdentityLedgerConsistency('test:exact-return')).toEqual([])
      expect(onError).not.toHaveBeenCalled()
    }
  )

  it('743 无 CardIDs 的暗手牌回到牌顶，不误判为随机入堆', () => {
    const { controller, room, pile, onError } = createHarness()
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1 }))
    const returnedCard = room.getPlayer(1)!.cards[0]

    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [],
        FromID: 1,
        FromPosition: POSITION_RANDOM,
        FromZone: 5,
        FromZoneParam: 0,
        MoveType: 15,
        SpellID: 743,
        ToID: 255,
        ToPosition: POSITION_TOP,
        ToZone: 1,
        ToZoneParam: 0
      })
    )

    expect(pile.cards).toHaveLength(3)
    expect(room.getPlayer(1)!.cards).toHaveLength(0)
    expect(pile.cards.at(-1)).toBe(returnedCard)
    expect(isAnonymous(returnedCard)).toBe(true)
    expect(room.assertPileIdentityLedgerConsistency('test:743-top-return')).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })
})
