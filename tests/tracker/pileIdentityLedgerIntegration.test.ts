import { describe, expect, it } from 'vitest'
import { POSITION_RANDOM } from '@/tracker/candidate/cardPositions'
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

  it('匿名获取跳过牌顶明牌，只消费暗占位并等待后续展示', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([1, 2, 3, 4])
    controller.revealTrackerCards(
      {
        type: 'public',
        zoneName: 'pile'
      },
      [1]
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
    const ledgerSnapshot = room.pileIdentityLedger.getSnapshot()

    expect(pile.cards.at(-1)).toMatchObject({ id: 1, isKnown: true })
    expect(ledgerSnapshot.knownPileIdentityIDs).toEqual([1])
    expect(ledgerSnapshot.hiddenPileSlotCount).toBe(2)
    expect(ledgerSnapshot.cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'partial',
        cardIDs: [2, 3, 4],
        remainingPileCount: 2,
        label: '这 3 张里有 2 张在牌堆'
      }
    ])
  })
})
