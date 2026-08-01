import { describe, expect, it } from 'vitest'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

describe('PileIdentityLedger integration', () => {
  it('成功协议移动后双写 Room ledger，并与 DEV observer 保持一致', () => {
    const warnCalls: unknown[][] = []
    const { controller } = createTrackerControllerHarness({
      logger: {
        warn(...args: unknown[]) {
          warnCalls.push(args)
        }
      }
    })

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
    const observerSnapshot = controller.getBeliefEpochReport()?.modelComparison.snapshot.cohort

    expect(ledgerSnapshot.hiddenPileSlotCount).toBe(4)
    expect(ledgerSnapshot.cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'partial',
        cardIDs: [1, 2, 3, 4, 5, 6],
        remainingPileCount: 4,
        label: '这 6 张里有 4 张在牌堆'
      }
    ])
    expect(ledgerSnapshot.cohort).toEqual(observerSnapshot)
    expect(warnCalls.some(([label]) => label === '牌堆身份生产账本与 DEV observer 不一致')).toBe(
      false
    )
  })

  it('显式揭示使用同一套 ledger/observer 双写入口', () => {
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
    const observerSnapshot = controller.getBeliefEpochReport()?.modelComparison.snapshot.cohort

    expect(ledgerSnapshot.knownPileIdentityIDs).toEqual([1])
    expect(ledgerSnapshot.hiddenPileSlotCount).toBe(2)
    expect(ledgerSnapshot.cohort).toEqual(observerSnapshot)
  })

  it('MoveType=18 匿名获得跳过牌顶明牌，只消费暗占位并等待后续展示', () => {
    const warnCalls: unknown[][] = []
    const { controller } = createTrackerControllerHarness({
      logger: {
        warn(...args: unknown[]) {
          warnCalls.push(args)
        }
      }
    })
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
        remainingPileCount: 3,
        label: '这 4 张里有 3 张在牌堆'
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

    const report = controller.getBeliefEpochReport()
    expect(pile.cards).toHaveLength(4)
    expect(room.pileIdentityLedger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'all-in-pile',
        cardIDs: [3, 4, 5],
        remainingPileCount: 3,
        label: '这 3 张都在牌堆'
      }
    ])
    expect(report?.modelComparison.degradations.map(({ reason }) => reason)).toEqual([
      'anonymous-pile-draw'
    ])
    expect(warnCalls.some(([label]) => label === '牌堆身份生产账本与 DEV observer 不一致')).toBe(
      false
    )
  })

  it('MoveType=1 常规摸牌同步扣除牌顶明牌身份与后续暗槽', () => {
    const warnCalls: unknown[][] = []
    const { controller } = createTrackerControllerHarness({
      logger: {
        warn(...args: unknown[]) {
          warnCalls.push(args)
        }
      }
    })
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
    const report = controller.getBeliefEpochReport()!

    expect(room.zones.get('pile')!.cards).toHaveLength(0)
    expect(ledgerSnapshot.knownPileIdentityIDs).toEqual([])
    expect(ledgerSnapshot.hiddenPileSlotCount).toBe(0)
    expect(ledgerSnapshot.cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'none-in-pile',
        cardIDs: [1],
        remainingPileCount: 0,
        label: '这 1 张都不在牌堆'
      }
    ])
    expect(ledgerSnapshot.cohort).toEqual(report.modelComparison.snapshot.cohort)
    expect(report.modelComparison.degradations).toEqual([])
    expect(warnCalls.some(([label]) => label === '牌堆身份生产账本与 DEV observer 不一致')).toBe(
      false
    )
  })
})
