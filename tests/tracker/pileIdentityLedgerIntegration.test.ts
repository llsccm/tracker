import { describe, expect, it } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

describe('PileIdentityLedger integration', () => {
  it('开局空弃牌堆洗牌通知不滚动世代或暂停初始卡池身份', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([1, 2, 3, 4])

    // 游戏开局可能发送与弃牌洗回相同的 2 -> 9 通知，但此时本地 discard 为空，CardCount
    // 只是完整牌堆张数。它不能被解释为旧世代结束，否则整副初始卡池会被错误标成 suspended。
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromZone: 2,
        ToZone: 9,
        MoveType: 0
      })
    )

    const room = controller.getTrackerRoom()
    expect(room.zones.get('pile')!.cards).toHaveLength(4)
    expect(room.zones.get('discard')!.cards).toEqual([])
    expect(room.suspendedKnownCards.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3, 4]))
    expect(room.pileIdentityLedger.getSnapshot().cohort.generation).toBe(0)
    expect(room.assertPileIdentityLedgerConsistency('test:initial-empty-shuffle')).toEqual([])
  })

  it('开局整副牌暂存在弃牌堆时洗回但不暂停初始卡池身份', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([1, 2, 3, 4])

    // 另一种开局协议会先把全部匿名槽移入 discard，再发送 2 -> 9。discard 数量等于整副
    // 卡池时仍属于初次洗牌，Room 需要重建物理牌堆，但不能关闭 generation 0。
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromZone: 1,
        ToZone: 2,
        MoveType: 1
      })
    )

    const room = controller.getTrackerRoom()
    expect(room.zones.get('pile')!.cards).toEqual([])
    expect(room.zones.get('discard')!.cards).toHaveLength(4)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromZone: 2,
        ToZone: 9,
        MoveType: 0
      })
    )

    expect(room.zones.get('pile')!.cards).toHaveLength(4)
    expect(room.zones.get('pile')!.cards.every(isAnonymous)).toBe(true)
    expect(room.zones.get('discard')!.cards).toEqual([])
    expect(room.suspendedKnownCards.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3, 4]))
    expect(room.pileIdentityLedger.getSnapshot().cohort).toMatchObject({
      generation: 0,
      groups: [
        {
          generation: 0,
          kind: 'all-in-pile',
          cardIDs: [1, 2, 3, 4],
          remainingPileCount: 4
        }
      ]
    })
    expect(room.assertPileIdentityLedgerConsistency('test:initial-full-discard-shuffle')).toEqual(
      []
    )
  })

  it('成功协议移动后更新 Room 权威身份账本', () => {
    const { controller } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([1, 2, 3, 4, 5, 6])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromPosition: POSITION_RANDOM,
        MoveType: 18,
        SpellID: 9999
      })
    )

    const room = controller.getTrackerRoom()
    const ledgerSnapshot = room.pileIdentityLedger.getSnapshot()

    expect(ledgerSnapshot.hiddenPileSlotCount).toBe(4)
    expect(ledgerSnapshot.cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'partial',
        cardIDs: [1, 2, 3, 4, 5, 6],
        remainingPileCount: 4
      }
    ])
    expect(room.assertPileIdentityLedgerConsistency('test:anonymous-gain')).toEqual([])
  })

  it('显式揭示通过同一后置入口更新权威身份账本', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([1, 2, 3])

    controller.revealTrackerCards(
      {
        type: 'public',
        zoneName: 'pile'
      },
      [1]
    )

    const room = controller.getTrackerRoom()
    const ledgerSnapshot = room.pileIdentityLedger.getSnapshot()

    expect(ledgerSnapshot.knownPileIdentityIDs).toEqual([1])
    expect(ledgerSnapshot.hiddenPileSlotCount).toBe(2)
    expect(room.assertPileIdentityLedgerConsistency('test:explicit-reveal')).toEqual([])
  })

  it('连续洗牌由 cohort 滚动并保留公开牌顶牌底身份', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([1, 2, 3, 4, 5, 6, 7, 8])
    controller.revealTrackerCards({ type: 'public', zoneName: 'pile' }, [1])
    controller.revealTrackerCards(
      {
        type: 'public',
        zoneName: 'pile',
        position: POSITION_BOTTOM,
        reposition: true
      },
      [2]
    )

    const room = controller.getTrackerRoom()
    const materializePileIdentities = (cardIDs: number[]) => {
      const pile = room.zones.get('pile')!
      cardIDs.forEach((cardID) => {
        const target = pile.cards.find(isAnonymous)
        expect(target).toBeTruthy()
        expect(room.materialize(cardID, target ?? null)).toBeTruthy()
      })
      room.applyPileIdentityReveal(cardIDs, 'pile')
    }

    // B13 只允许精确消费来源区中已经存在的同 ID 实体；为连续洗牌夹具显式建立这层
    // 协议事实，避免用 CardID 凭空指认某个更深的匿名牌堆槽。
    materializePileIdentities([3, 4])

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [3, 4],
        CardCount: 2,
        FromZone: 1,
        FromPosition: POSITION_RANDOM,
        MoveType: 18,
        ToZone: 2
      })
    )

    const shuffle = () => {
      const cardCount =
        room.zones.get('pile')!.cards.length + room.zones.get('discard')!.cards.length
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [],
          CardCount: cardCount,
          FromZone: 2,
          MoveType: 255,
          ToZone: 9
        })
      )
    }

    shuffle()

    expect(room.pileIdentityLedger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [1, 2],
      accountedPileCount: 8
    })
    expect(room.pileIdentityLedger.getSnapshot().cohort.generation).toBe(1)
    expect(room.zones.get('pile')!.cards.at(-1)).toMatchObject({ id: 1, isKnown: true })
    expect(room.cardIndex.get(2)).toMatchObject({ isKnown: true, location: 'pile' })
    expect(room.cardIndex.has(3)).toBe(false)
    expect(room.cardIndex.has(4)).toBe(false)
    expect(room.unlocatedIdentities.has(3)).toBe(true)
    expect(room.unlocatedIdentities.has(4)).toBe(true)
    expect(
      room.zones
        .get('pile')!
        .cards.filter((card) => card.id !== 1 && card.id !== 2)
        .every(isAnonymous)
    ).toBe(true)
    expect(
      Array.from(room.suspendedKnownCards, (card) => card.id).sort((left, right) => left - right)
    ).toEqual([5, 6, 7, 8])

    materializePileIdentities([5])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [5],
        CardCount: 1,
        FromZone: 1,
        FromPosition: POSITION_RANDOM,
        MoveType: 18,
        ToZone: 2
      })
    )
    shuffle()

    const ledgerSnapshot = room.pileIdentityLedger.getSnapshot()
    expect(ledgerSnapshot.cohort.generation).toBe(2)
    expect(ledgerSnapshot.knownPileIdentityIDs).toEqual([1, 2])
    expect(ledgerSnapshot.accountedPileCount).toBe(8)
    expect(room.zones.get('pile')!.cards.at(-1)).toMatchObject({ id: 1, isKnown: true })
    expect(room.cardIndex.get(2)).toMatchObject({ isKnown: true, location: 'pile' })
    expect(room.cardIndex.has(5)).toBe(false)
    expect(room.unlocatedIdentities.has(3)).toBe(false)
    expect(room.unlocatedIdentities.has(4)).toBe(false)
    expect(room.unlocatedIdentities.has(5)).toBe(true)
    expect(room.zones.get('discard')!.cards).toEqual([])
    expect(
      Array.from(room.suspendedKnownCards, (card) => card.id).sort((left, right) => left - right)
    ).toEqual([3, 4, 6, 7, 8])
    expect(room.assertPileIdentityLedgerConsistency('test:second-shuffle')).toEqual([])
  })

  it('MoveType=18 匿名获得跳过牌顶明牌，只消费暗占位并等待后续展示', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([1, 2, 3, 4, 5])
    controller.revealTrackerCards(
      {
        type: 'public',
        zoneName: 'pile'
      },
      [1]
    )
    controller.revealTrackerCards(
      {
        type: 'public',
        zoneName: 'pile',
        position: POSITION_BOTTOM,
        reposition: true
      },
      [2]
    )

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        MoveType: 18,
        SpellID: 4567
      })
    )

    const room = controller.getTrackerRoom()
    const pile = room.zones.get('pile')!

    expect(pile.cards.at(-1)).toMatchObject({ id: 1, isKnown: true })
    expect(room.pileIdentityLedger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [1],
      hiddenPileSlotCount: 3,
      accountedPileCount: 4
    })
    expect(room.pileIdentityLedger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'partial',
        cardIDs: [2, 3, 4, 5],
        remainingPileCount: 3
      }
    ])

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [2],
        CardCount: 1,
        FromZone: 5,
        FromID: 1,
        ToZone: 2,
        ToID: 0,
        MoveType: 4
      })
    )

    expect(pile.cards).toHaveLength(4)
    expect(room.pileIdentityLedger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'all-in-pile',
        cardIDs: [3, 4, 5],
        remainingPileCount: 3
      }
    ])
    expect(room.assertPileIdentityLedgerConsistency('test:delayed-reveal')).toEqual([])
  })

  it('MoveType=1 常规摸牌同步扣除牌顶明牌身份与后续暗槽', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([1])

    controller.syncTrackerMove(
      protocolMove({
        FromZone: 0,
        FromID: 0,
        ToZone: 1,
        ToID: 255,
        CardIDs: [2],
        CardCount: 1,
        MoveType: 15
      })
    )

    let room = controller.getTrackerRoom()
    expect(room.zones.get('pile')!.cards.at(-1)).toMatchObject({ id: 2, isKnown: true })
    expect(room.pileIdentityLedger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [2],
      hiddenPileSlotCount: 1
    })

    controller.syncTrackerMove(
      protocolMove({ CardIDs: [], CardCount: 2, MoveType: 1, FromPosition: POSITION_TOP })
    )

    room = controller.getTrackerRoom()
    const ledgerSnapshot = room.pileIdentityLedger.getSnapshot()

    expect(room.zones.get('pile')!.cards).toHaveLength(0)
    expect(ledgerSnapshot.knownPileIdentityIDs).toEqual([])
    expect(ledgerSnapshot.hiddenPileSlotCount).toBe(0)
    expect(ledgerSnapshot.cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'none-in-pile',
        cardIDs: [1],
        remainingPileCount: 0
      }
    ])
    expect(room.assertPileIdentityLedgerConsistency('test:regular-draw')).toEqual([])
  })
})
