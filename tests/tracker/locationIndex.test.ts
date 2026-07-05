import { describe, expect, it } from 'vitest'
import { createTestRoom, getCard } from './helpers/room'
import { playerLocation } from './helpers/locationCandidates'

describe('CardLocationIndex 投影', () => {
  it('稳定投影确定手牌、候选手牌和各类玩家位置候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1, 2] })
    const knownHand = getCard(room, 1)
    const candidateHand = getCard(room, 2)
    const handOrMark = getCard(room, 3)
    const equipCandidate = getCard(room, 4)
    const judgeCandidate = getCard(room, 5)

    room.clearCardsFromPublicZones([
      knownHand,
      candidateHand,
      handOrMark,
      equipCandidate,
      judgeCandidate
    ])
    knownHand.bindCandidates([1], 'hand', null, { known: true })
    candidateHand.bindCandidates([1, 2], 'hand', null, { known: true })
    handOrMark.confirmKnown()
    handOrMark.setLocationCandidates([playerLocation(1, 'hand'), playerLocation(1, 'mark', 700)])
    equipCandidate.confirmKnown()
    equipCandidate.setLocationCandidates([playerLocation(1, 'equip')])
    judgeCandidate.confirmKnown()
    judgeCandidate.setLocationCandidates([playerLocation(2, 'judge')])

    room.locationIndex.rebuild(room)

    expect(room.locationIndex.knownHandBySeat.get(1)).toEqual([knownHand])
    expect(room.locationIndex.knownHandBySeat.get(2)).toEqual([])
    expect(room.locationIndex.candidateHandBySeat.get(1)).toEqual([candidateHand, handOrMark])
    expect(room.locationIndex.candidateHandBySeat.get(2)).toEqual([candidateHand])
    expect(room.locationIndex.equipBySeat.get(1)).toEqual([equipCandidate])
    expect(room.locationIndex.judgeBySeat.get(2)).toEqual([judgeCandidate])
    expect(room.locationIndex.markBySeatAndSpell.get(1).get(700)).toEqual([handOrMark])
  })

  it('暗标记牌不投影到可见标记区', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })
    const hiddenMark = getCard(room, 1)

    room.clearCardsFromPublicZones([hiddenMark])
    hiddenMark.bindCandidates([1], 'mark', 700, { known: false })
    room.locationIndex.rebuild(room)

    expect(room.locationIndex.markBySeatAndSpell.get(1)?.has(700) ?? false).toBe(false)
  })
})
