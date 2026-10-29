import { trackerLogger } from '@/utils/logger'
import { getPublicFieldCandidateCards } from '@/tracker/view/publicFieldCandidates'
import { CARD_INSTANCE_STATUS } from '@/tracker/projection/CardCounter'
import { expectLocationIndexMatchesRebuild } from './helpers/locationIndex'
import { createTestRoom, getSuspendedIdentityIDs } from './helpers/room'
import { describe, expect, it, vi } from 'vitest'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { normalizeTrackerMovePosition } from '@/tracker/protocol/protocolRules'
import {
  createErrorSpy,
  protocolMove,
  createReadyControllerHarness
} from './helpers/trackerController'

/** 两个暗手牌槽、三张明弃牌及一个剩余牌堆槽，用于跨世代身份回归。 */
function createAnonymousShuffleRoom(observeCount = false) {
  const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5, 6], seatIDs: [1] })
  const pile = room.zones.get('pile')!
  const discard = room.zones.get('discard')!
  room.moveCards([], {
    from: { type: 'public', zone: 'pile', position: POSITION_TOP },
    to: { type: 'player', seatID: 1, subZone: 'hand' },
    cardCount: 2
  })
  if (observeCount) room.getPlayer(1).syncObservedHandCount(2)
  room.moveCards([1, 2, 3], {
    from: { type: 'public', zone: 'pile', position: POSITION_TOP },
    to: { type: 'public', zone: 'discard', position: POSITION_TOP },
    cardCount: 3
  })
  return { room, pile, discard }
}

describe('PileIdentityLedger integration', () => {
  it.each([
    { drawIDs: [19, 56], toPosition: POSITION_TOP + 1 },
    { drawIDs: [], toPosition: POSITION_RANDOM }
  ])('浑天仪随机入堆后匿名化，装备与摸牌不串用身份（%j）', ({ drawIDs, toPosition }) => {
    const errorSpy = createErrorSpy()
    const { controller, room } = createReadyControllerHarness({
      players: [{ SeatID: 3, ClientID: 100 }],
      cardIDs: [19, 56, 80, 81]
    })
    const pile = room.zones.get('pile')!
    const huntianyiIDs = [31023, 31022, 31021, 31020]

    huntianyiIDs.forEach((cardID, index) => {
      const raw = protocolMove({
        CardIDs: [cardID],
        FromZone: 0,
        ToZone: 1,
        ToID: 255,
        ToPosition: toPosition,
        MoveType: 19,
        SpellID: 3694
      })
      controller.syncTrackerMove({ ...raw, ...normalizeTrackerMovePosition(raw) }, raw)

      expect(pile.cards).toHaveLength(5 + index)
      expect(pile.cards.every((card) => card.isAnonymous && !card.isKnown)).toBe(true)
      expect(room.cardIndex.has(cardID)).toBe(false)
      expect(room.unlocatedIdentities.has(cardID)).toBe(true)
      expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([])
      expect(room.assertPileIdentityLedgerConsistency('test:huntianyi-insert')).toEqual([])
    })

    const entityCount = room.cards.length
    const createExternalSpy = vi.spyOn(room, 'createExternalCards')
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [31022],
        FromPosition: POSITION_RANDOM,
        ToID: 3,
        ToZone: 6,
        ToPosition: POSITION_RANDOM,
        MoveType: 15,
        SpellID: 3694
      })
    )

    const equipment = room.cardIndex.get(31022)!
    expect(equipment.location).toBe('player')
    expect(equipment.subZone).toBe('equip')
    expect(equipment.seats).toEqual(new Set([3]))
    expect(equipment.isKnown).toBe(true)
    expect(pile.cards).toHaveLength(7)

    controller.syncTrackerMove(protocolMove({ CardIDs: drawIDs, CardCount: 2, ToID: 3 }))

    const handCards = room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(3)
    )
    expect(handCards).toHaveLength(2)
    if (drawIDs.length > 0) {
      expect(handCards.map((card) => card.id).sort((a, b) => a - b)).toEqual(drawIDs)
      expect(handCards.every((card) => card.isKnown)).toBe(true)
    }
    if (drawIDs.length === 0) {
      expect(handCards.every((card) => card.isAnonymous && !card.isKnown)).toBe(true)
    }
    expect(pile.cards).toHaveLength(5)
    expect(pile.cards.every((card) => card.isAnonymous && !card.isKnown)).toBe(true)
    expect(room.cardIndex.get(31022)).toBe(equipment)
    expect(equipment.subZone).toBe('equip')
    huntianyiIDs
      .filter((cardID) => cardID !== 31022)
      .forEach((cardID) => {
        expect(room.cardIndex.has(cardID)).toBe(false)
        expect(room.unlocatedIdentities.has(cardID)).toBe(true)
      })
    expect(room.cards).toHaveLength(entityCount)
    expect(createExternalSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(room.assertPileIdentityLedgerConsistency('test:huntianyi-draw')).toEqual([])
  })

  it('开局空弃牌堆洗牌通知不滚动世代或暂停初始卡池身份', () => {
    const { controller } = createReadyControllerHarness({ seatIDs: [1], cardIDs: [1, 2, 3, 4] })

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
    const { controller } = createReadyControllerHarness({ seatIDs: [1], cardIDs: [1, 2, 3, 4] })

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
    expect(room.zones.get('pile')!.cards.every((card) => card.isAnonymous)).toBe(true)
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

  it('洗牌先提交账本世代过渡，再重建物理牌堆', () => {
    const { controller } = createReadyControllerHarness({ seatIDs: [1], cardIDs: [1, 2, 3, 4] })
    controller.revealTrackerCards({ type: 'public', zoneName: 'pile' }, [1])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [1],
        CardCount: 1,
        FromZone: 1,
        FromPosition: POSITION_TOP,
        ToZone: 2,
        ToID: 0,
        MoveType: 4
      })
    )

    const room = controller.getTrackerRoom()
    const pile = room.zones.get('pile')!
    const ledgerApplySpy = vi.spyOn(room.pileIdentityLedger, 'applyMove')
    const replaceAllSpy = vi.spyOn(pile, 'replaceAll')

    try {
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [],
          CardCount: 4,
          FromZone: 2,
          MoveType: 255,
          ToZone: 9
        })
      )

      // Room 只能根据已提交的世代过渡创建 suspended，不能先改物理区再读取旧账本快照。
      expect(ledgerApplySpy).toHaveBeenCalledTimes(1)
      expect(replaceAllSpy).toHaveBeenCalledTimes(1)
      expect(ledgerApplySpy.mock.invocationCallOrder[0]).toBeLessThan(
        replaceAllSpy.mock.invocationCallOrder[0]
      )
    } finally {
      ledgerApplySpy.mockRestore()
      replaceAllSpy.mockRestore()
    }

    expect(room.pileIdentityLedger.getSnapshot().cohort.generation).toBe(1)
    expect(room.unlocatedIdentities.has(1)).toBe(true)
    expect(
      Array.from(room.suspendedKnownCards, (card) => card.id).sort((left, right) => left - right)
    ).toEqual([2, 3, 4])
    expect(room.assertPileIdentityLedgerConsistency('test:shuffle-commit-order')).toEqual([])
  })

  it('成功协议移动后更新 Room 权威身份账本', () => {
    const { controller } = createReadyControllerHarness({
      seatIDs: [1],
      cardIDs: [1, 2, 3, 4, 5, 6]
    })
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
    const { controller } = createReadyControllerHarness({ seatIDs: [1], cardIDs: [1, 2, 3] })

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

  it('弃牌区重复明示不会撤销已知弃牌身份', () => {
    const { controller } = createReadyControllerHarness({ seatIDs: [1], cardIDs: [1, 2, 3] })
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [1],
        CardCount: 1,
        FromZone: 1,
        FromPosition: POSITION_TOP,
        MoveType: 4,
        ToZone: 2
      })
    )

    const room = controller.getTrackerRoom()
    const discard = room.zones.get('discard')!
    const discardCard = room.cardIndex.get(1)
    expect(discard.cards).toContain(discardCard)
    expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs).toEqual([1])

    // public 只是明示目标，已有实体会继续停在 discard；账本必须读取同步后的实际位置。
    controller.revealTrackerCards({ type: 'public', zoneName: 'discard' }, [1])

    expect(discard.cards).toContain(discardCard)
    expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs).toEqual([1])
    expect(room.assertPileIdentityLedgerConsistency('test:discard-repeat-reveal')).toEqual([])
  })

  it('思泣将已知弃牌移回牌堆时保持 Room 与 ledger 身份分区一致', () => {
    const { controller } = createReadyControllerHarness({ seatIDs: [1], cardIDs: [1, 2, 127] })

    // 先把 127 物化为公开牌顶，再按真实流程弃置。实测思泣回堆消息没有携带位置字段，
    // 但 CardID 已经精确证明该身份仍在牌堆，不能因此退回仅承载未定位身份的 cohort。
    controller.revealTrackerCards({ type: 'public', zoneName: 'pile' }, [127])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [127],
        CardCount: 1,
        FromZone: 1,
        FromPosition: POSITION_TOP,
        MoveType: 4,
        ToZone: 2
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [127],
        CardCount: 1,
        FromID: 255,
        FromZone: 2,
        FromPosition: undefined,
        MoveType: 15,
        SpellID: 3543,
        ToID: 255,
        ToZone: 1,
        ToPosition: undefined
      })
    )

    const room = controller.getTrackerRoom()
    expect(room.zones.get('pile')!.cards.at(-1)).toMatchObject({ id: 127, isKnown: true })
    expect(room.unlocatedIdentities.has(127)).toBe(false)
    expect(room.pileIdentityLedger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [127],
      cohort: {
        groups: [{ cardIDs: [1, 2], remainingPileCount: 2 }]
      }
    })
    expect(room.assertPileIdentityLedgerConsistency('test:siqi-known-return')).toEqual([])
  })

  it('匿名任意位置获得后保留牌底已知身份并允许后续移动到 mark', () => {
    const { controller } = createReadyControllerHarness({ seatIDs: [1], cardIDs: [1, 2, 3, 127] })

    // 127 先从弃牌区明确回到牌堆底，1 再成为公开牌顶。无 CardIDs 的 MoveType=18
    // 只消费两者之间的匿名槽，不撤销任何已经明确在牌堆中的身份。
    controller.revealTrackerCards({ type: 'public', zoneName: 'pile' }, [127])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [127],
        CardCount: 1,
        FromZone: 1,
        FromPosition: POSITION_TOP,
        MoveType: 4,
        ToZone: 2
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [127],
        CardCount: 1,
        FromID: 255,
        FromZone: 2,
        FromPosition: POSITION_RANDOM,
        MoveType: 15,
        SpellID: 3543,
        ToID: 255,
        ToZone: 1,
        ToPosition: POSITION_BOTTOM
      })
    )
    controller.revealTrackerCards({ type: 'public', zoneName: 'pile' }, [1])

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromPosition: POSITION_RANDOM,
        MoveType: 18,
        SpellID: 4567,
        ToID: 1
      })
    )

    const room = controller.getTrackerRoom()
    const pile = room.zones.get('pile')!
    expect(pile.cards.at(-1)).toMatchObject({ id: 1, isKnown: true })
    expect(pile.cards[0]).toMatchObject({ id: 127, isKnown: true })
    expect(room.cardIndex.get(127)).toMatchObject({ location: 'pile', isKnown: true })
    expect(room.unlocatedIdentities.has(127)).toBe(false)
    expect(room.pileIdentityLedger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [1, 127],
      cohort: {
        groups: [{ cardIDs: [2, 3], remainingPileCount: 1 }]
      }
    })
    expect(room.assertPileIdentityLedgerConsistency('test:anonymous-gain-preserve-known')).toEqual(
      []
    )

    // 后续匿名手牌进入 mark 不改变牌堆身份，127 仍应保持精确牌底展示。
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromID: 1,
        FromZone: 5,
        MoveType: 8,
        SpellID: 9001,
        ToID: 1,
        ToZone: 4,
        ToZoneParam: 9001
      })
    )
    expect(pile.cards[0]).toMatchObject({ id: 127, isKnown: true })
    expect(room.assertPileIdentityLedgerConsistency('test:move-to-mark-preserve-known')).toEqual([])
  })

  it('匿名任意位置获得保留连续十张已知牌底身份', () => {
    const knownBottomIDs = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110]
    const { controller } = createReadyControllerHarness({
      seatIDs: [1],
      cardIDs: [1, 2, ...knownBottomIDs]
    })
    controller.revealTrackerCards(
      {
        type: 'public',
        zoneName: 'pile',
        position: POSITION_BOTTOM,
        reposition: true
      },
      knownBottomIDs
    )

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromPosition: POSITION_RANDOM,
        MoveType: 18,
        SpellID: 4567,
        ToID: 1
      })
    )

    const room = controller.getTrackerRoom()
    const pile = room.zones.get('pile')!
    expect(new Set(pile.cards.slice(0, knownBottomIDs.length).map((card) => card.id))).toEqual(
      new Set(knownBottomIDs)
    )
    knownBottomIDs.forEach((cardID) => {
      expect(room.cardIndex.get(cardID)).toMatchObject({ location: 'pile', isKnown: true })
      expect(room.unlocatedIdentities.has(cardID)).toBe(false)
    })
    expect(room.pileIdentityLedger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: knownBottomIDs,
      hiddenPileSlotCount: 1,
      cohort: {
        groups: [{ cardIDs: [1, 2], remainingPileCount: 1 }]
      }
    })
    expect(room.assertPileIdentityLedgerConsistency('test:ten-known-bottom-cards')).toEqual([])
  })

  it('连续洗牌由 cohort 滚动并保留公开牌顶牌底身份', () => {
    const { controller } = createReadyControllerHarness({
      seatIDs: [1],
      cardIDs: [1, 2, 3, 4, 5, 6, 7, 8]
    })
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
        const target = pile.cards.find((card) => card.isAnonymous)
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
        .every((card) => card.isAnonymous)
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

  it('MoveType=18 匿名获得跳过全部已知牌堆身份，只消费暗占位并等待后续展示', () => {
    const { controller } = createReadyControllerHarness({ seatIDs: [1], cardIDs: [1, 2, 3, 4, 5] })
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
    expect(room.cardIndex.get(2)).toMatchObject({ location: 'pile', isKnown: true })
    expect(room.pileIdentityLedger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [1, 2],
      hiddenPileSlotCount: 2,
      accountedPileCount: 4
    })
    expect(room.pileIdentityLedger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'partial',
        cardIDs: [3, 4, 5],
        remainingPileCount: 2
      }
    ])
    expect(room.assertPileIdentityLedgerConsistency('test:anonymous-gain-known-pile')).toEqual([])

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
    const { controller } = createReadyControllerHarness({ seatIDs: [1], cardIDs: [1] })

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
  it('技能3571从牌堆揭示陈旧已知手牌时置换实体并保持牌堆数量', () => {
    const { controller } = createReadyControllerHarness({
      players: [{ SeatID: 5, ClientID: 100 }],
      cardIDs: [1, 2, 3, 4, 34, 68, 161]
    })
    controller.syncTrackerMove(protocolMove({ CardIDs: [161], ToID: 5 }))

    const skillMove = (cardID, fromZone, toZone, fromID = 255) =>
      protocolMove({
        CardIDs: [cardID],
        CardCount: 1,
        FromID: fromID,
        FromZone: fromZone,
        FromZoneParam: 0,
        MoveType: 6,
        SpellID: 3571,
        ToID: 255,
        ToZone: toZone,
        ToZoneParam: 0
      })

    controller.syncTrackerMove(skillMove(34, 1, 3))
    controller.syncTrackerMove(skillMove(34, 3, 8))
    controller.syncTrackerMove(skillMove(68, 1, 3))
    controller.syncTrackerMove(skillMove(68, 3, 8))

    const room = controller.getTrackerRoom()
    const pileCountBeforeLastReveal = room.zones.get('pile').cards.length

    controller.syncTrackerMove(skillMove(161, 1, 3, 5))

    const seatFiveHandCards = room.cards.filter(
      (card) =>
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(5) &&
        card.isKnown !== true
    )
    expect(room.cardIndex.get(161).location).toBe('process')
    expect(room.zones.get('pile').cards).toHaveLength(pileCountBeforeLastReveal - 1)
    expect(seatFiveHandCards).toHaveLength(1)
    expect(seatFiveHandCards[0].id).not.toBe(0)
  })

  it('未知摸牌只移动匿名槽且不提前认领真实身份', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })

    room.moveCards([], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 1, subZone: 'hand' },
      cardCount: 2,
      sourceEvent: { type: 'stage1:draw-unknown' }
    })

    const hiddenHand = room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand'
    )
    expect(hiddenHand).toHaveLength(2)
    expect(hiddenHand.every((card) => card.isAnonymous)).toBe(true)
    expect(room.zones.get('pile')!.cards).toHaveLength(2)
    expect(room.cardIndex.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3, 4]))
  })

  it('牌堆来源明牌原地物化且不触发旧冲突修复路径', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const originalTopSlot = pile.cards.at(-1)

    room.moveCards([4], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 1, subZone: 'hand' },
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-known' }
    })

    const card = room.cardIndex.get(4)
    expect(card).toBe(originalTopSlot)
    expect(card?.entityID).toBe(4)
    expect(card?.location).toBe('player')
    expect(card?.isKnown).toBe(true)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3]))
    expect(pile.cards).toHaveLength(3)
  })

  it('公共 known 不覆盖正 ID 暗牌顶，缺失实体走诊断兜底', () => {
    const { room } = createTestRoom({
      materializeDeckIdentities: true,
      cardIDs: [1, 2, 3, 4, 5],
      seatIDs: [1]
    })
    const pile = room.zones.get('pile')!
    const hiddenTopCard = pile.cards.at(-1)!
    const displacedIdentityID = hiddenTopCard.id
    const releasedSlot = room.cardIndex.get(4)!
    room.anonymizeLocatedIdentity(releasedSlot, 'test:phase5-unlocated-source', {
      preservePlacement: true
    })
    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})

    try {
      // 这是 Phase 4 后生产流程不应再产生的兼容状态：牌顶仍承载正 ID 1，但牌面未公开。
      // Phase 5 必须拒绝用协议身份 4 覆盖它；由于端点没有匿名槽，known 路径只能留下
      // 可观测诊断并补建身份 4，不能继续伪造“1 只是可替换的本地代表”。
      room.moveCards([4], {
        from: { type: 'public', zone: 'pile', position: POSITION_TOP },
        to: { type: 'player', seatID: 1, subZone: 'hand' },
        cardCount: 1,
        sourceEvent: { type: 'stage1:draw-unlocated-from-positive-hidden-top' }
      })

      expect(infoSpy).toHaveBeenCalledWith(
        'known 路径实体缺口，将 createExternal',
        expect.anything()
      )
    } finally {
      infoSpy.mockRestore()
    }

    const fallbackCard = room.cardIndex.get(4)
    expect(fallbackCard).toBeTruthy()
    expect(fallbackCard).not.toBe(hiddenTopCard)
    expect(fallbackCard?.location).toBe('player')
    expect(fallbackCard?.isKnown).toBe(true)
    expect(pile.cards).toHaveLength(5)
    expect(pile.cards.at(-1)).toBe(hiddenTopCard)
    // known 解析没有覆盖端点；随后完整 Room 事务把旧 cohort 身份投影回匿名槽。
    expect(hiddenTopCard.isAnonymous).toBe(true)
    expect(hiddenTopCard.isKnown).toBe(false)
    expect(room.cardIndex.has(displacedIdentityID)).toBe(false)
    expect(room.unlocatedIdentities.has(displacedIdentityID)).toBe(true)
    expect(room.suspendedKnownCards.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3, 5]))
  })

  it('游戏外匿名手牌首次揭示时扩展并物化身份全集', () => {
    const { room } = createTestRoom({
      cardIDs: [1],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const [placeholder] = room.createExternalCards([], 1)
    placeholder.bindCandidates([1], 'hand', null, { known: false })

    room.moveCards([60992], {
      from: { type: 'player', seatID: 1, subZone: 'hand' },
      to: { type: 'player', seatID: 1, subZone: 'hand' },
      cardCount: 1,
      sourceEvent: { type: 'stage1:reveal-external-hand' }
    })

    expect(room.cardIndex.get(60992)).toBe(placeholder)
    expect(placeholder.id).toBe(60992)
    expect(placeholder.isKnown).toBe(true)
    expect(room.deckIdentities.has(60992)).toBe(true)
    expect(room.unlocatedIdentities.has(60992)).toBe(false)
  })

  it('公共区来源无匿名槽可物化时补建缺失正 ID', () => {
    const { room } = createTestRoom({
      cardIDs: [1],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    pile.clear()

    room.moveCards([77], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 1, subZone: 'hand' },
      cardCount: 1,
      sourceEvent: { type: 'stage1:public-missing-fallback' }
    })

    const card = room.cardIndex.get(77)
    expect(card).toBeTruthy()
    expect(card?.location).toBe('player')
    expect(card?.subZone).toBe('hand')
    expect(card?.isKnown).toBe(true)
    expect(room.deckIdentities.has(77)).toBe(true)
    expect(room.unlocatedIdentities.has(77)).toBe(false)
  })

  it('洗牌为未决身份创建 suspended 展示实体并保留玩家匿名槽位', () => {
    const { room, pile, discard } = createAnonymousShuffleRoom(true)

    const playerSlots = room.cards.filter((card) => card.isAnonymous && card.location === 'player')
    const remainingPileSlot = pile.cards[0]
    const playerSlotEntityIDs = playerSlots.map((card) => card.entityID)

    expect(playerSlots).toHaveLength(2)
    expect(pile.cards).toEqual([remainingPileSlot])
    expect(discard.cards).toHaveLength(3)
    expect(room.unlocatedIdentities).toEqual(new Set([4, 5, 6]))

    room.shufflePile({ cardCount: 4 })

    expect(getSuspendedIdentityIDs(room)).toEqual([4, 5, 6])
    expect(Array.from(room.cardIndex.keys()).sort((left, right) => left - right)).toEqual([4, 5, 6])
    expect(
      getPublicFieldCandidateCards(room)
        .map((card) => card.id)
        .sort((left, right) => left - right)
    ).toEqual([4, 5, 6])
    room.suspendedKnownCards.forEach((card) => {
      expect(card.location).toBe('suspended')
      expect(card.isKnown).toBe(true)
      expect(card.suspended).toBe(true)
      expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.APPEARED]).toContain(card)
    })
    expectLocationIndexMatchesRebuild(room)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3]))
    expect(discard.cards).toEqual([])
    expect(pile.cards).toHaveLength(4)
    expect(pile.cards).toContain(remainingPileSlot)
    expect(pile.cards.every((card) => card.isAnonymous)).toBe(true)
    expect(playerSlots.map((card) => card.entityID)).toEqual(playerSlotEntityIDs)
    playerSlots.forEach((card) => {
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.isKnown).toBe(false)
    })
    expect(room.getPlayer(1).unknownCardCount).toBe(2)
  })

  it('洗牌后连续明摸只物化匿名牌堆槽', () => {
    const { room, pile } = createAnonymousShuffleRoom()
    room.shufflePile({ cardCount: 4 })
    expect(pile.cards.every((card) => card.isAnonymous)).toBe(true)
    expect(getSuspendedIdentityIDs(room)).toEqual([4, 5, 6])

    room.moveCards([4], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 1, subZone: 'hand' },
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-suspended-from-anonymous-top' }
    })
    expect(pile.cards).toHaveLength(3)
    expect(room.cardIndex.get(4)).toMatchObject({ location: 'player', isKnown: true })
    expect(getSuspendedIdentityIDs(room)).toEqual([5, 6])

    room.moveCards([5], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 1, subZone: 'hand' },
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-suspended-from-positive-hidden-top' }
    })

    expect(pile.cards).toHaveLength(2)
    expect(room.cardIndex.get(5)).toMatchObject({ location: 'player', isKnown: true })
    expect(getSuspendedIdentityIDs(room)).toEqual([6])
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3]))
  })

  it('洗牌新建的暂停身份逆序进入手牌并二次洗牌时保持增量索引顺序', () => {
    const { room } = createAnonymousShuffleRoom()
    room.shufflePile({ cardCount: 4 })
    ;[6, 5].forEach((cardID) => {
      room.moveCards([cardID], {
        from: { type: 'public', zone: 'pile', position: POSITION_TOP },
        to: { type: 'player', seatID: 1, subZone: 'hand' },
        cardCount: 1,
        sourceEvent: { type: 'stage1:draw-suspended-out-of-creation-order' }
      })
    })
    room.moveCards([6], {
      from: { type: 'player', seatID: 1, subZone: 'hand' },
      to: { type: 'public', zone: 'discard', position: POSITION_TOP },
      cardCount: 1,
      sourceEvent: { type: 'stage1:discard-before-second-shuffle' }
    })
    room.shufflePile({ cardCount: 3 })

    expectLocationIndexMatchesRebuild(room)
  })

  it('连续洗牌沿用历史 suspended 并暂停下一世代尚未出现的身份', () => {
    const { room, pile, discard } = createAnonymousShuffleRoom()
    room.shufflePile({ cardCount: 4 })

    const hiddenPileCard = pile.cards.at(-1)!
    const hiddenPileEntityID = hiddenPileCard.entityID
    room.moveCards([], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 1, subZone: 'hand' },
      sourceCards: [hiddenPileCard],
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-positive-hidden-before-second-shuffle' }
    })

    room.moveCards([4], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'public', zone: 'discard', position: POSITION_TOP },
      cardCount: 1,
      sourceEvent: { type: 'stage1:discard-before-second-shuffle-summary' }
    })

    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})
    try {
      room.shufflePile({ cardCount: pile.cards.length + discard.cards.length })

      expect(getSuspendedIdentityIDs(room)).toEqual([1, 2, 3, 5, 6])
      expect(infoSpy).toHaveBeenCalledWith(
        '洗牌后暂停追踪旧牌堆世代中尚未出现的身份',
        expect.objectContaining({ suspendedCardIDs: [1, 2, 3] })
      )
    } finally {
      infoSpy.mockRestore()
    }

    expect(hiddenPileCard.entityID).toBe(hiddenPileEntityID)
    expect(hiddenPileCard.location).toBe('player')
    expect(hiddenPileCard).toSatisfy((card) => card.isAnonymous)
    expect(pile.cards.every((card) => card.isAnonymous)).toBe(true)
    expect(room.cardIndex.has(4)).toBe(false)
    expect(room.unlocatedIdentities).toEqual(new Set([4]))
  })

  it('玩家匿名槽揭示后再次洗牌仍保持身份全集', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const discard = room.zones.get('discard')!

    room.moveCards([1, 2, 3], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'public', zone: 'discard', position: POSITION_TOP },
      cardCount: 3,
      sourceEvent: { type: 'stage1:discard-before-hidden-identity-shuffle' }
    })
    room.shufflePile({ cardCount: 4 })

    const hiddenPileCard = pile.cards.at(-1)!
    room.moveCards([], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 1, subZone: 'hand' },
      sourceCards: [hiddenPileCard],
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-positive-hidden-player-placeholder' }
    })
    room.moveCards([4], {
      from: { type: 'player', seatID: 1, subZone: 'hand' },
      to: { type: 'public', zone: 'discard', position: POSITION_TOP },
      cardCount: 1,
      sourceEvent: { type: 'stage1:reveal-suspended-from-positive-hidden-placeholder' }
    })

    const revealedIdentity = room.cardIndex.get(4)!
    expect(revealedIdentity).not.toBe(hiddenPileCard)
    expect(revealedIdentity.location).toBe('discard')
    expect(revealedIdentity.isKnown).toBe(true)
    expect(hiddenPileCard).toSatisfy((card) => card.isAnonymous)
    expect(hiddenPileCard.location).toBe('outside')

    room.shufflePile({ cardCount: pile.cards.length + discard.cards.length })

    expect(revealedIdentity).toSatisfy((card) => card.isAnonymous)
    expect(revealedIdentity.location).toBe('pile')
    expect(getSuspendedIdentityIDs(room)).toEqual([1, 2, 3])
    expect(room.cardIndex.size).toBe(3)
    expect(room.unlocatedIdentities).toEqual(new Set([4]))
    expect(room.deckIdentities.size).toBe(4)
  })
})
