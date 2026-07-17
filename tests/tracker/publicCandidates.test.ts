import { describe, expect, it } from 'vitest'
import { ConstraintGroup } from '@/tracker/ConstraintGroup'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { createTestRoom, getCard } from './helpers/room'
import { playerHand, publicLocation } from './helpers/locationCandidates'

describe('公共候选传播', () => {
  it('暗手牌置于牌堆顶时显示牌顶候选文案', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1] })
    const knownCandidate = getCard(room, 1)
    const hiddenCard = getCard(room, 2)

    room.clearCardsFromPublicZones([knownCandidate, hiddenCard])
    knownCandidate.bindCandidates([1], 'hand', null, { known: true })
    hiddenCard.bindCandidates([1], 'hand', null, { known: false })
    room.getPlayer(1).syncObservedHandCount(2)

    room.moveCards([], 'pile', {
      fromSeatID: 1,
      fromZone: null,
      fromSubZone: 'hand',
      cardCount: 1,
      position: POSITION_TOP,
      sourceEvent: { type: 'test:spell-743-put-on-pile-top' }
    })

    expect(knownCandidate.publicCandidates).toEqual([
      expect.objectContaining({
        zone: 'pile',
        position: 'top',
        count: 1,
        label: '牌堆顶前1张'
      })
    ])
  })

  it('牌堆顶候选进入手牌时保留公共候选与玩家候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1] })
    const first = getCard(room, 1)
    const second = getCard(room, 2)
    const pileTop = publicLocation('pile', 'top', 2)
    const targetHand = playerHand(1)

    first.confirmKnown()
    second.confirmKnown()
    first.setLocationCandidates([pileTop])
    second.setLocationCandidates([pileTop])

    const affectedCards = room.movement.propagatePublicCandidatesToHand({
      fromZone: 'pile',
      fromPosition: POSITION_TOP,
      toZone: 'player',
      targetSeat: 1,
      subZone: 'hand',
      count: 1,
      sourceEvent: { type: 'test:draw-public-candidate' }
    })

    expect(affectedCards).toEqual([first, second])
    ;[first, second].forEach((card) => {
      expect(card.publicCandidates).toEqual([
        expect.objectContaining({
          zone: 'pile',
          position: 'top',
          count: 1
        })
      ])
      expect(
        card
          .getLocationCandidates()
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      ).toEqual(
        [
          createLocationCandidateKey(publicLocation('pile', 'top', 1)),
          createLocationCandidateKey(targetHand)
        ].sort()
      )
    })
  })

  it('牌堆顶候选数量未知时进入手牌后保留未知公共候选', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })
    const card = getCard(room, 1)
    const pileTop = publicLocation('pile', 'top')
    const targetHand = playerHand(1)

    card.confirmKnown()
    card.setLocationCandidates([pileTop])

    const affectedCards = room.movement.propagatePublicCandidatesToHand({
      fromZone: 'pile',
      fromPosition: POSITION_TOP,
      toZone: 'player',
      targetSeat: 1,
      subZone: 'hand',
      count: 1,
      sourceEvent: { type: 'test:draw-unknown-public-candidate' }
    })

    expect(affectedCards).toEqual([card])
    expect(card.publicCandidates).toEqual([
      expect.objectContaining({
        zone: 'pile',
        position: 'top',
        count: null
      })
    ])
    expect(
      card
        .getLocationCandidates()
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    ).toEqual([createLocationCandidateKey(pileTop), createLocationCandidateKey(targetHand)].sort())
  })

  it('删除手牌候选后只剩公共候选时仍保持候选态', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })
    const card = getCard(room, 1)
    const pileTop = publicLocation('pile', 'top', 2)
    const hand = playerHand(1)

    card.confirmKnown()
    card.setLocationCandidates([pileTop, hand])

    card.removeLocationCandidate(hand, 'test:remove-hand')

    expect(card.location).toBe('player')
    expect(card.publicCandidates).toEqual([
      expect.objectContaining({
        zone: 'pile',
        position: 'top',
        count: 2
      })
    ])
    expect(
      card.getLocationCandidates().map((candidate) => createLocationCandidateKey(candidate))
    ).toEqual([createLocationCandidateKey(pileTop)])
  })

  it('手牌配额排除后只剩公共候选时仍保持候选态', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })
    const card = getCard(room, 1)
    const pileTop = publicLocation('pile', 'top', 2)
    const hand = playerHand(1)

    card.confirmKnown()
    card.setLocationCandidates([pileTop, hand])
    room.getPlayer(1).syncObservedHandCount(0)

    room.resolveConstraints()

    expect(card.location).toBe('player')
    expect(card.publicCandidates).toEqual([
      expect.objectContaining({
        zone: 'pile',
        position: 'top',
        count: 2
      })
    ])
    expect(
      card.getLocationCandidates().map((candidate) => createLocationCandidateKey(candidate))
    ).toEqual([createLocationCandidateKey(pileTop)])
  })

  it('公共候选未被完整位置约束覆盖时不强锁到手牌', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    const pileTop = publicLocation('pile', 'top', 2)
    const pileBottom = publicLocation('pile', 'bottom', 1)
    const targetHand = playerHand(2)

    card.confirmKnown()
    card.setLocationCandidates([pileTop, pileBottom, targetHand])

    const group = new ConstraintGroup({
      id: 'public-candidate-to-hand',
      cards: [card],
      expectedSlotsByLocation: new Map([[createLocationCandidateKey(targetHand), 1]])
    })

    group.resolve()

    expect(
      card
        .getLocationCandidates()
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    ).toEqual(
      [
        createLocationCandidateKey(pileTop),
        createLocationCandidateKey(pileBottom),
        createLocationCandidateKey(targetHand)
      ].sort()
    )
    expect(card.subZone).toBe(null)
  })

  it('公共位置名额已满时剔除组内其他公共候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1] })
    const exactPileCard = getCard(room, 1)
    const candidateCard = getCard(room, 2)
    const pile = publicLocation('pile')
    const targetHand = playerHand(1)

    exactPileCard.confirmKnown()
    candidateCard.confirmKnown()
    candidateCard.setLocationCandidates([pile, targetHand])

    const group = new ConstraintGroup({
      id: 'public-slot-full',
      cards: [exactPileCard, candidateCard],
      expectedSlotsByLocation: new Map([
        [createLocationCandidateKey(pile), 1],
        [createLocationCandidateKey(targetHand), 1]
      ])
    })

    group.resolve()

    expect(candidateCard.location).toBe('player')
    expect(candidateCard.subZone).toBe('hand')
    expect(candidateCard.seats.has(1)).toBe(true)
    expect(candidateCard.publicCandidates).toEqual([])
    expect(candidateCard.getLocationCandidates()).toEqual([])
  })

  it('公共具体位置名额不被同区域确定牌提前占满', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1] })
    const exactPileCard = getCard(room, 1)
    const candidateCard = getCard(room, 2)
    const pileTop = publicLocation('pile', 'top', 1)
    const targetHand = playerHand(1)

    exactPileCard.confirmKnown()
    candidateCard.confirmKnown()
    candidateCard.setLocationCandidates([pileTop, targetHand])

    const group = new ConstraintGroup({
      id: 'public-specific-slot-not-full-by-zone',
      cards: [exactPileCard, candidateCard],
      expectedSlotsByLocation: new Map([[createLocationCandidateKey(pileTop), 1]])
    })

    group.resolve()

    expect(candidateCard.subZone).toBe(null)
    expect(candidateCard.publicCandidates).toEqual([
      expect.objectContaining({
        zone: 'pile',
        position: 'top',
        count: 1
      })
    ])
    expect(
      candidateCard
        .getLocationCandidates()
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    ).toEqual([createLocationCandidateKey(pileTop), createLocationCandidateKey(targetHand)].sort())
  })
})
