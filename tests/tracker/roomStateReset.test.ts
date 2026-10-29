import { describe, expect, it, vi } from 'vitest'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { fromPublicCandidate } from '@/tracker/candidate/locationCandidate'
import { createPublicCandidate } from '@/tracker/candidate/publicCandidate'
import { createTestRoom } from './helpers/room'

function createRoomWithTrackedState() {
  const { room, gameState } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
  room.moveCards([1, 3], {
    from: { type: 'public', zone: 'pile', position: POSITION_TOP },
    to: { type: 'player', seatID: 1, subZone: 'hand' }
  })
  const card = room.cardIndex.get(1)!
  card.bindCandidates([1, 2], 'hand', null, { known: true })
  room.createConstraintGroup({
    cards: [card],
    candidateSeats: [1, 2],
    known: true,
    sourceEvent: { type: 'test:old-deck', label: '旧牌堆来源' }
  })
  const candidate = fromPublicCandidate(createPublicCandidate('pile', POSITION_TOP, 2))!
  room.revealPublicCandidates([2], candidate)
  room.constraints.suspendKnownCard(room.cardIndex.get(3)!, 'test:old-deck')
  room.resolveConstraints()

  expect(room.constraintGroups.size).toBeGreaterThan(0)
  expect(room.detachedKnownCards.size).toBe(1)
  expect(room.suspendedKnownCards.size).toBe(1)
  expect(room.dirtyCardEvents.length).toBeGreaterThan(0)
  expect(room.maxResolveRounds).toBeGreaterThan(0)
  return { room, gameState }
}

describe('Room 牌堆状态重置', () => {
  it('重新建牌堆清除旧推断和事件，新牌仍可增量更新，座位和插件继续使用', () => {
    const { room, gameState } = createRoomWithTrackedState()
    const player = room.getPlayer(1)!
    const onDeckInitialized = vi.fn()
    room.registerSkillPlugin({ id: 'test:reset-state', onDeckInitialized })

    room.initDeck([5, 6, 7])

    expect(gameState.room).toBe(room)
    expect(room.getPlayer(1)).toBe(player)
    expect(room.seatIDs).toEqual([1, 2])
    expect(room.firstID).toBe(1)
    expect(room.mySeatID).toBe(1)
    expect(onDeckInitialized).toHaveBeenCalledOnce()
    expect(room.constraintGroups.size).toBe(0)
    expect(room.constraintGroupSeq).toBe(0)
    expect(room.detachedKnownCards.size).toBe(0)
    expect(room.suspendedKnownCards.size).toBe(0)
    expect(room.dirtyCards.size).toBe(0)
    expect(room.dirtyCardEvents).toEqual([])
    expect(room.dirtyCardSeq).toBe(0)
    expect(room.lastResolveRounds).toBe(0)
    expect(room.maxResolveRounds).toBe(0)
    expect(room.cardIndex.size).toBe(0)
    expect(room.playerCardsSnapshot).toEqual([])
    expect(player.knownHandCards).toEqual([])
    expect(player.candidateHandCards).toEqual([])
    expect(room.ambiguousKnownIndex.items.size).toBe(0)
    expect(room.deckIdentities).toEqual(new Set([5, 6, 7]))
    expect(room.unlocatedIdentities).toEqual(new Set([5, 6, 7]))
    expect(room.cards.map((card) => card.id)).toEqual([-1, -2, -3])
    expect(room.assertPileIdentityLedgerConsistency('test:reset-deck')).toEqual([])

    room.moveCards([5], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 2, subZone: 'hand' }
    })

    const card = room.cardIndex.get(5)!
    expect(room.playerCardsSnapshot).toContain(card)
    expect(room.locationIndex.knownHandBySeat.get(2)).toEqual([card])
    expect(room.dirtyCardEvents.every((event) => room.cards.includes(event.card))).toBe(true)
    expect(room.assertPileIdentityLedgerConsistency('test:reset-deck-move')).toEqual([])
  })

  it('销毁后释放牌实体、约束、身份账本与派生索引，并解绑座位和插件', () => {
    const { room, gameState } = createRoomWithTrackedState()
    const card = room.cardIndex.get(1)!
    const onCardsRevealed = vi.fn()
    room.registerSkillPlugin({ id: 'test:reset-state', onCardsRevealed })

    room.destroy()

    expect(gameState.room).toBeNull()
    expect(room.players.size).toBe(0)
    expect(room.seatIDs).toEqual([])
    expect(room.cards).toEqual([])
    expect(room.detachedKnownCards.size).toBe(0)
    expect(room.cardIndex.size).toBe(0)
    expect(room.constraintGroups.size).toBe(0)
    expect(room.suspendedKnownCards.size).toBe(0)
    expect(room.dirtyCards.size).toBe(0)
    expect(room.dirtyCardEvents).toEqual([])
    expect(room.dirtyCardSeq).toBe(0)
    expect(room.dirtyPublicZones.size).toBe(0)
    expect(room.viewDirty).toBe(false)
    expect(room.playerCardsSnapshot).toEqual([])
    expect(room.locationIndex.knownHandBySeat.size).toBe(0)
    expect(room.locationIndex.candidateHandBySeat.size).toBe(0)
    expect(Array.from(room.locationIndex.publicByZone.values()).flat()).toEqual([])
    expect(room.ambiguousKnownIndex.items.size).toBe(0)
    expect(room.deckIdentities.size).toBe(0)
    expect(room.unlocatedIdentities.size).toBe(0)
    expect(room.assertPileIdentityLedgerConsistency('test:destroy')).toEqual([])
    expect(card.isKnown).toBe(false)
    expect(card.seats.size).toBe(0)
    room.notifyCardsRevealed([1])
    expect(onCardsRevealed).not.toHaveBeenCalled()
  })
})
