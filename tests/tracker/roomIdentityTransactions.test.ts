import { describe, expect, it, vi } from 'vitest'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { fromPublicCandidate } from '@/tracker/candidate/locationCandidate'
import { createPublicCandidate } from '@/tracker/candidate/publicCandidate'
import { MOVE_TYPE } from '@/tracker/protocol/MoveEventNormalizer'
import { trackerLogger } from '@/utils/logger'
import { createTestRoom } from './helpers/room'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

const topThree = fromPublicCandidate(createPublicCandidate('pile', POSITION_TOP, 3))!

describe('Room 身份事务', () => {
  it('直调移动完成摸牌、弃牌、定点回堆与随机回堆账本', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    room.moveCards([1, 2], 'player', { toSeatID: 1, fromZone: 'pile' })
    expect(room.pileIdentityLedger.getSnapshot().locatedIdentityIDs).toEqual([1, 2])
    room.moveCards([1, 2], 'discard', { fromSeatID: 1, fromSubZone: 'hand' })
    expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs).toEqual([1, 2])
    room.moveCards([1], 'pile', { fromZone: 'discard', position: POSITION_BOTTOM })
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([1])
    room.moveCards([2], 'pile', { fromZone: 'discard', position: POSITION_RANDOM })
    expect(room.cardIndex.has(2)).toBe(false)
    expect(room.unlocatedIdentities.has(2)).toBe(true)
    expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs).toEqual([])
    expect(room.assertPileIdentityLedgerConsistency('direct-moves')).toEqual([])
  })

  it.each([POSITION_TOP, POSITION_BOTTOM])('直调常规暗摸精确消费端点明牌（%s）', (position) => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    room.materializeAtPublicEndpoint([1], 'pile', position)
    room.applyPileIdentityReveal([1])
    const physicalCount = room.cards.length
    room.moveCards([], 'player', {
      toSeatID: 1,
      cardCount: 2,
      moveType: MOVE_TYPE.DRAW,
      fromPosition: position
    })
    expect(room.cardIndex.get(1)?.resolvedSeat).toBe(1)
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([])
    expect(room.pileIdentityLedger.getSnapshot().accountedPileCount).toBe(2)
    expect(room.cards).toHaveLength(physicalCount)
    expect(room.assertPileIdentityLedgerConsistency('direct-draw')).toEqual([])
  })

  it('匿名化预检失败时实体和账本都不提交', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
    const pileBefore = [...room.getPublicZone('pile').cards]
    const ledgerBefore = room.pileIdentityLedger.getSnapshot()
    const warn = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})
    try {
      expect(
        room.moveCards([], 'player', {
          toSeatID: 1,
          cardCount: 1,
          anonymizeCards: [pileBefore[0]],
          requireAnonymizeSuccess: true
        })
      ).toBe(false)
      expect(room.getPublicZone('pile').cards).toEqual(pileBefore)
      expect(room.pileIdentityLedger.getSnapshot()).toEqual(ledgerBefore)
      expect(room.getPlayer(1)?.observedHandCount).toBe(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('Controller 普通移动仅提交一次身份事务', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 1 }], 1)
    controller.initTrackerDeck([1, 2, 3])
    const room = controller.getTrackerRoom()!
    const revision = room.pileIdentityLedger.getSnapshot().revision
    controller.syncTrackerMove(protocolMove({ CardIDs: [1], ToID: 1 }))
    expect(room.pileIdentityLedger.getSnapshot().revision).toBe(revision + 1)
    expect(room.assertPileIdentityLedgerConsistency('controller-once')).toEqual([])
  })
})

describe('公共范围身份的物理容量', () => {
  it('重复范围揭示不增加物理槽，索引全量重建仍保留候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    const physicalCards = [...room.cards]
    const pileBefore = [...room.getPublicZone('pile').cards]
    const [identity] = room.revealPublicCandidates([1], topThree)
    expect(room.revealPublicCandidates([1], topThree)).toEqual([identity])
    expect(room.cards).toEqual(physicalCards)
    expect(room.getPublicZone('pile').cards).toEqual(pileBefore)
    expect(room.detachedKnownCards).toEqual(new Set([identity]))
    expect(identity.suspended).toBe(false)
    room.ambiguousKnownIndex.rebuild([])
    expect(room.ambiguousKnownIndex.get(1)?.card).toBe(identity)
    expect(room.assertPileIdentityLedgerConsistency('detached-reveal')).toEqual([])
  })

  it('端点揭示在原匿名槽物化身份并回收范围载体', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    const target = room.getPublicZone('pile').cards.at(-1)!
    const [identity] = room.revealPublicCandidates([1], topThree)
    const materialized = room.materializeAtPublicEndpoint([1], 'pile', POSITION_TOP)
    room.applyPileIdentityReveal([1])
    room.resolveConstraints()
    expect(materialized).toEqual([target])
    expect(room.cardIndex.get(1)).toBe(target)
    expect(target.isKnown).toBe(true)
    expect(room.cards).toHaveLength(4)
    expect(room.detachedKnownCards.size).toBe(0)
    expect(room.ambiguousKnownIndex.get(1)).toBeNull()
    expect(room.counter.cardsByStatus.flatMap((cards) => Array.from(cards))).not.toContain(identity)
    expect(room.assertPileIdentityLedgerConsistency('detached-materialized')).toEqual([])
  })

  it('候选暗摸后在玩家匿名槽揭示，不新增牌或残留候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    room.revealPublicCandidates([1], topThree)
    room.moveCards([], 'player', { toSeatID: 1, cardCount: 1, moveType: MOVE_TYPE.DRAW })
    const target = room.cards.find((card) => card.location === 'player' && card.isAnonymous)!
    expect(room.cardIndex.get(1)?.publicCandidates).toHaveLength(1)
    room.moveCards([1], 'discard', { fromSeatID: 1, fromSubZone: 'hand' })
    expect(room.cardIndex.get(1)).toBe(target)
    expect(room.getPublicZone('discard').cards).toEqual([target])
    expect(room.detachedKnownCards.size).toBe(0)
    expect(room.cards).toHaveLength(4)
    expect(room.assertPileIdentityLedgerConsistency('detached-player')).toEqual([])
  })

  it('整个候选范围被摸走后复用手牌匿名槽落定身份', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    room.revealPublicCandidates([1], topThree)
    room.moveCards([], 'player', { toSeatID: 1, cardCount: 3, moveType: MOVE_TYPE.DRAW })
    expect(room.detachedKnownCards.size).toBe(0)
    expect(room.cards).toHaveLength(4)
    expect(room.cards.filter((card) => card.location === 'player')).toHaveLength(3)
    expect(room.getPlayer(1)?.knownHandCards.map((card) => card.id)).toEqual([1])
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([])
    expect(room.assertPileIdentityLedgerConsistency('detached-range-draw')).toEqual([])
  })

  it('端点没有匿名槽时保留范围身份，不覆盖其他正 ID 或增加实体', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    room.materializeAtPublicEndpoint([2], 'pile', POSITION_TOP)
    room.applyPileIdentityReveal([2])
    const [identity] = room.revealPublicCandidates([1], topThree)
    expect(room.materializeAtPublicEndpoint([1], 'pile', POSITION_TOP)).toEqual([])
    expect(room.cardIndex.get(1)).toBe(identity)
    expect(room.getPublicZone('pile').cards.at(-1)?.id).toBe(2)
    expect(room.cards).toHaveLength(4)
    expect(room.assertPileIdentityLedgerConsistency('detached-blocked-endpoint')).toEqual([])
  })

  it('断档重建及新增候选之后保持增量玩家索引的顺序与内容', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5, 6] })
    room.revealPublicCandidates([2], topThree)
    room.locationIndex.rebuild(room)
    room.rebuildPlayerSnapshot()
    room.revealPublicCandidates([1], topThree)
    room.moveCards([], 'player', { toSeatID: 1, cardCount: 1, moveType: MOVE_TYPE.DRAW })
    const incremental = [...room.playerCardsSnapshot]
    const candidates = [...room.getPlayer(1)!.candidateHandCards]
    expect(room.rebuildPlayerSnapshot()).toEqual(incremental)
    room.locationIndex.rebuild(room)
    expect(room.locationIndex.candidateHandBySeat.get(1)).toEqual(candidates)
    expect(room.cards).toHaveLength(6)
  })
})
