import { describe, expect, it } from 'vitest'
import { createTestRoom, getCard } from './helpers/room'

describe('玩家手牌数观测', () => {
  it('未观测时负向 delta 不建立 0 张手牌快照', () => {
    const { room } = createTestRoom({ seatIDs: [1] })
    const player = room.getPlayer(1)

    player.applyObservedHandCountDelta(-1)

    expect(player.hasObservedHandCount).toBe(false)
    expect(player.observedHandCount).toBe(0)
    expect(player.unknownCardCount).toBe(0)

    player.syncObservedHandCount(3)
    player.applyObservedHandCountDelta(-1)

    expect(player.hasObservedHandCount).toBe(true)
    expect(player.observedHandCount).toBe(2)
  })

  it('未观测来源手牌传播时不把默认 0 当作真实手牌数', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    const first = getCard(room, 1)
    const second = getCard(room, 2)
    const sourcePlayer = room.getPlayer(1)

    room.clearCardsFromPublicZones([first, second])
    ;[first, second].forEach((card) => {
      card.bindCandidates([1], 'hand', null, { known: true })
    })

    expect(sourcePlayer.hasObservedHandCount).toBe(false)

    const candidateCards = room.movement.markRandomHandTransferCandidates({
      fromSeat: 1,
      targetSeat: 2,
      count: 1,
      sourceEvent: { type: 'test:random-hand-transfer' }
    })
    const group = Array.from(room.constraintGroups.values()).find(
      (constraintGroup) =>
        (constraintGroup.sourceEvent as { type?: string } | null)?.type ===
        'test:random-hand-transfer'
    )

    expect(candidateCards).toEqual([first, second])
    expect(group.expectedSlotsBySeat.get(1)).toBe(2)
    expect(group.expectedSlotsBySeat.get(2)).toBe(1)
  })
})
