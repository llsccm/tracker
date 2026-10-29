import { describe, expect, it, vi } from 'vitest'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { MOVE_TYPE } from '@/tracker/protocol/MoveEventNormalizer'
import type { RawMoveCardEvent } from '@/tracker/types'
import {
  createErrorSpy,
  protocolMove,
  createReadyControllerHarness
} from './helpers/trackerController'

function createHarness(sourceIDs = [11, 12, 0], targetIDs = [13, 0]) {
  const errorSpy = createErrorSpy()
  const { controller, gameState, room } = createReadyControllerHarness({
    players: [
      { SeatID: 1, ClientID: 10 },
      { SeatID: 4, ClientID: 40 },
      { SeatID: 7, ClientID: 70 }
    ],
    currentUserID: 70,
    cardIDs: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  })
  for (const [seatID, ids] of [
    [1, sourceIDs],
    [4, targetIDs]
  ] as const) {
    const knownIDs = ids.filter((id) => id > 0)
    const unknownCount = ids.length - knownIDs.length
    if (knownIDs.length)
      controller.syncTrackerMove(protocolMove({ CardIDs: knownIDs, ToID: seatID }))
    if (unknownCount)
      controller.syncTrackerMove(
        protocolMove({ CardIDs: [], CardCount: unknownCount, ToID: seatID })
      )
  }
  room.getPlayer(1)!.syncObservedHandCount(sourceIDs.length)
  room.getPlayer(4)!.syncObservedHandCount(targetIDs.length)
  room.resolveConstraints()
  gameState.currentID = 1
  return { controller, gameState, room, errorSpy }
}

function giveMove(overrides: Partial<RawMoveCardEvent> = {}) {
  return protocolMove({
    CardIDs: [],
    CardCount: 1,
    FromID: 1,
    FromZone: 5,
    FromPosition: POSITION_RANDOM,
    ToID: 4,
    ToZone: 5,
    MoveType: MOVE_TYPE.GIVE,
    SpellID: 780,
    ...overrides
  })
}

function returnMove(overrides: Partial<RawMoveCardEvent> = {}) {
  return protocolMove({
    CardIDs: [],
    CardCount: 1,
    FromID: 4,
    FromZone: 5,
    FromPosition: POSITION_RANDOM,
    ToID: 255,
    ToZone: 1,
    ToPosition: POSITION_BOTTOM,
    MoveType: MOVE_TYPE.MOVE,
    SpellID: 780,
    ...overrides
  })
}

describe('问卦候选来源筛选', () => {
  it.each([POSITION_BOTTOM, POSITION_TOP])(
    '只向交牌来源的明牌传播位置 %i，不污染 B 原有明牌',
    (position) => {
      const { controller, room, errorSpy } = createHarness()
      const sourceCards = [room.cardIndex.get(11)!, room.cardIndex.get(12)!]
      const originalTargetCard = room.cardIndex.get(13)!
      const pile = room.zones.get('pile')!
      const pileCount = pile.cards.length
      const give = giveMove()
      controller.syncTrackerMove(give)
      const transferGroups = [...room.constraintGroups.values()].filter(
        (group) =>
          group.cards.has(sourceCards[0]) &&
          group.expectedSlotsByLocation.get('player:4:hand:none')?.max === 1
      )
      expect(transferGroups.length).toBeGreaterThan(0)

      const moveSpy = vi.spyOn(room, 'moveCards')
      const returned = returnMove({ ToPosition: position })
      controller.syncTrackerMove(returned)
      expect(give.CardIDs).toEqual([])
      expect(returned.CardIDs).toEqual([])
      expect(moveSpy.mock.lastCall?.[0]).toEqual([])
      expect(moveSpy.mock.lastCall?.[1]).toMatchObject({
        from: { type: 'player', seatID: 4, subZone: 'hand' },
        publicCandidateSource: { fromSeat: 1, cards: sourceCards }
      })
      expect(moveSpy.mock.lastCall?.[1]?.sourceCards).toBeUndefined()
      expect(moveSpy.mock.lastCall?.[1]?.pileIdentityCardIDs).toBeUndefined()
      sourceCards.forEach((card) => {
        expect(card.publicCandidates).toContainEqual(
          expect.objectContaining({
            zone: 'pile',
            position: position === POSITION_BOTTOM ? 'bottom' : 'top',
            count: 1
          })
        )
      })
      expect(originalTargetCard.publicCandidates).toEqual([])
      expect(originalTargetCard.seats).toEqual(new Set([4]))
      expect(originalTargetCard.isKnown).toBe(true)
      transferGroups.forEach((group) => {
        expect(group.expectedSlotsByLocation.has('player:1:hand:none')).toBe(false)
        expect(group.expectedSlotsByLocation.has('player:4:hand:none')).toBe(false)
        expect(group.expectedSlotsByLocation.size).toBe(0)
      })
      expect(room.getPlayer(1)!.observedHandCount).toBe(2)
      expect(room.getPlayer(4)!.observedHandCount).toBe(2)
      expect(pile.cards).toHaveLength(pileCount + 1)
      expect(room.hasSkillState(780)).toBe(false)
      expect(room.assertPileIdentityLedgerConsistency('test:wengua-candidate-return')).toEqual([])

      controller.syncTrackerMove(
        protocolMove({ CardIDs: [], CardCount: 1, FromPosition: position, ToID: 7 })
      )
      expect(originalTargetCard.seats).toEqual(new Set([4]))
      expect(originalTargetCard.publicCandidates).toEqual([])
      expect(room.assertPileIdentityLedgerConsistency('test:wengua-candidate-draw')).toEqual([])
      expect(errorSpy).not.toHaveBeenCalled()
    }
  )

  it('A 全暗时传递空候选集合，不能回退到 B 的全部明牌', () => {
    const { controller, room, errorSpy } = createHarness([0, 0])
    const moveSpy = vi.spyOn(room, 'moveCards')
    controller.syncTrackerMove(giveMove())
    controller.syncTrackerMove(returnMove())
    expect(moveSpy.mock.lastCall?.[1]?.publicCandidateSource).toEqual({ fromSeat: 1, cards: [] })
    expect(room.cardIndex.get(13)!.publicCandidates).toEqual([])
    expect(room.cardIndex.get(13)!.seats).toEqual(new Set([4]))
    expect(room.assertPileIdentityLedgerConsistency('test:wengua-dark-source')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('可见 ID 的交互视角仍直接走通用已知牌移动', () => {
    const { controller, room, errorSpy } = createHarness()
    controller.syncTrackerMove(giveMove({ CardIDs: [11] }))
    expect(room.hasSkillState(780)).toBe(false)
    const moveSpy = vi.spyOn(room, 'moveCards')
    controller.syncTrackerMove(returnMove({ CardIDs: [11] }))
    expect(moveSpy.mock.lastCall?.[1]?.publicCandidateSource).toBeUndefined()
    expect(room.zones.get('pile')!.cards[0].id).toBe(11)
    expect(room.cardIndex.get(13)!.publicCandidates).toEqual([])
    expect(room.assertPileIdentityLedgerConsistency('test:wengua-visible')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('B 原本没有暗牌时，失效旧数量约束仍保留 A 明牌的回堆可能性', () => {
    const { controller, room, errorSpy } = createHarness([11, 12, 0], [13])
    controller.syncTrackerMove(giveMove())
    controller.syncTrackerMove(returnMove())
    for (const id of [11, 12]) {
      expect(room.cardIndex.get(id)!.publicCandidates).toContainEqual(
        expect.objectContaining({ zone: 'pile', position: 'bottom', count: 1 })
      )
    }
    expect(room.cardIndex.get(13)!.seats).toEqual(new Set([4]))
    expect(room.cardIndex.get(13)!.publicCandidates).toEqual([])
    expect(room.getPlayer(4)!.observedHandCount).toBe(1)
    expect(room.assertPileIdentityLedgerConsistency('test:wengua-known-recipient')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it.each(['wrong-seat', 'wrong-type', 'wrong-count', 'visible'])(
    '配对失效后不复用旧来源：%s',
    (reason) => {
      const { controller, room } = createHarness()
      controller.syncTrackerMove(giveMove())
      const moveSpy = vi.spyOn(room, 'moveCards')
      const overrides =
        reason === 'wrong-seat'
          ? { FromID: 1 }
          : reason === 'wrong-type'
            ? { MoveType: MOVE_TYPE.GIVE }
            : reason === 'wrong-count'
              ? { CardCount: 2 }
              : reason === 'visible'
                ? { CardIDs: [11] }
                : {}
      controller.syncTrackerMove(returnMove(overrides))
      expect(moveSpy.mock.lastCall?.[1]?.publicCandidateSource).toBeUndefined()
      expect(room.hasSkillState(780)).toBe(false)
    }
  )

  it('没有待配对交牌时，普通暗回堆保留原通用候选传播', () => {
    const { controller, room } = createHarness()
    controller.syncTrackerMove(returnMove({ SpellID: 4567 }))
    expect(room.cardIndex.get(13)!.publicCandidates).toContainEqual(
      expect.objectContaining({ zone: 'pile', position: 'bottom', count: 1 })
    )
  })

  it('其它技能的移动不会调用问卦候选筛选器', () => {
    const { controller, room } = createHarness()
    const stateSpy = vi.spyOn(room, 'readSkillState')
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1, ToID: 7, SpellID: 4567 }))
    expect(stateSpy.mock.calls.some(([key]) => key === 780)).toBe(false)
    expect(room.hasSkillState(780)).toBe(false)
  })

  it('新 Room 不继承上一局的问卦候选记录', () => {
    const { controller } = createHarness()
    controller.syncTrackerMove(giveMove())
    expect(controller.getTrackerRoom()!.hasSkillState(780)).toBe(true)
    controller.destroyTrackerRoom()
    controller.initTrackerRoom()
    expect(controller.getTrackerRoom()!.hasSkillState(780)).toBe(false)
  })
})
