import { describe, expect, it } from 'vitest'
import { ConstraintGroup } from '@/tracker/ConstraintGroup'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { createTestRoom, getCard } from './helpers/room'
import { locationKeys, playerLocation, publicLocation } from './helpers/locationCandidates'

describe('完整位置候选回归', () => {
  it('owner 收敛后仍保留同一 owner 下的手牌/标记候选', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    const seatOneHand = playerLocation(1, 'hand')
    const seatTwoHand = playerLocation(2, 'hand')
    const seatOneMark = playerLocation(1, 'mark', 700)

    card.confirmKnown()
    card.setLocationCandidates([seatOneHand, seatTwoHand, seatOneMark])
    card.setSeats([1], 'test:exclude-seat-2')

    expect(card.owner).toBe(1)
    expect(card.subZone).toBe(null)
    expect(locationKeys(card)).toEqual(
      [createLocationCandidateKey(seatOneHand), createLocationCandidateKey(seatOneMark)].sort()
    )
    expect(card.getSubZoneCandidates()).toHaveLength(2)
  })

  it('多座位候选重复投影后约束组 resolve 保持幂等', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)

    card.bindCandidates([1, 2], 'hand', null, { known: true })
    // 回归：候选席位与当前投影一致时，resolve 不能为了重建同一候选而返回 true。
    const group = new ConstraintGroup({
      id: 'test:idempotent-candidate-seats',
      cards: [card],
      candidateSeats: [1, 2]
    })

    expect(group.resolve()).toBe(false)
    expect(group.resolve()).toBe(false)
  })

  it('多座位 player 候选重投影时保留同牌非 player 候选', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    const pileTop = publicLocation('pile', 'top', 1)
    const seatOneHand = playerLocation(1, 'hand')
    const seatTwoHand = playerLocation(2, 'hand')

    card.bindCandidates([1, 2], 'hand', null, { known: true })
    card.setLocationCandidates([pileTop, seatOneHand, seatTwoHand])

    expect(card.setSeats([1, 2], 'test:repeat-player-projection')).toBe(false)
    expect(locationKeys(card)).toEqual(
      [
        createLocationCandidateKey(pileTop),
        createLocationCandidateKey(seatOneHand),
        createLocationCandidateKey(seatTwoHand)
      ].sort()
    )
  })

  it('重叠约束组切换 combinationID 不驱动 resolve 重循环', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    const firstGroup = new ConstraintGroup({ id: 'test:overlap-a', cards: [card] })
    const secondGroup = new ConstraintGroup({ id: 'test:overlap-b', cards: [card] })

    firstGroup.apply()
    secondGroup.apply()

    // 回归：同一张牌可同时属于多个组，combinationID 只能作为标签，不能成为收敛状态。
    expect(firstGroup.resolve()).toBe(false)
  })

  it('暗牌额度归零不会影响已落定的手牌', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })
    const card = getCard(room, 1)
    const hand = playerLocation(1, 'hand')

    card.confirmKnown()
    card.setLocationCandidates([hand])
    room.getPlayer(1).syncObservedHandCount(1)

    room.resolveConstraints()

    expect(card.owner).toBe(1)
    expect(card.subZone).toBe('hand')
    expect(locationKeys(card)).toEqual([])
  })

  it.each([1, 2, 3])('4 选 %s 标记区可按完整位置约束收敛', (markCount) => {
    const cardIDs = [1, 2, 3, 4]
    const { room } = createTestRoom({ cardIDs, seatIDs: [1] })
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 700)
    const cards = cardIDs.map((id) => getCard(room, id))

    cards.forEach((card) => {
      card.confirmKnown()
      card.setLocationCandidates([hand, mark])
    })
    cards.slice(0, markCount).forEach((card) => {
      card.resolveLocationCandidate(mark, 'test:known-mark')
    })

    const group = new ConstraintGroup({
      id: `mark-${markCount}`,
      cards,
      expectedSlotsByLocation: new Map([
        [createLocationCandidateKey(hand), 4 - markCount],
        [createLocationCandidateKey(mark), markCount]
      ])
    })

    group.resolve()

    cards.slice(0, markCount).forEach((card) => {
      expect(card.subZone).toBe('mark')
      expect(card.spellID).toBe(700)
    })
    cards.slice(markCount).forEach((card) => {
      expect(card.subZone).toBe('hand')
      expect(card.spellID).toBe(null)
      expect(card.getLocationCandidates()).toEqual([])
    })
  })

  it('三类约束交叉时只排除已满手牌名额并保留标记候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    const lockedHandCard = getCard(room, 1)
    const ambiguousCard = getCard(room, 2)
    const seatOneHand = playerLocation(1, 'hand')
    const seatTwoHand = playerLocation(2, 'hand')
    const seatTwoMark = playerLocation(2, 'mark', 700)

    lockedHandCard.bindCandidates([1], 'hand', null, { known: true })
    ambiguousCard.confirmKnown()
    ambiguousCard.setLocationCandidates([seatOneHand, seatTwoHand, seatTwoMark])
    room.getPlayer(1).syncObservedHandCount(1)

    room.createConstraintGroup({
      id: 'test:p1-cross-constraints',
      cards: [ambiguousCard],
      expectedSlotsByLocation: new Map([[createLocationCandidateKey(seatTwoMark), 1]])
    })
    room.resolveConstraints()

    expect(ambiguousCard.owner).toBe(2)
    expect(ambiguousCard.subZone).toBe(null)
    expect(locationKeys(ambiguousCard)).toEqual(
      [createLocationCandidateKey(seatTwoHand), createLocationCandidateKey(seatTwoMark)].sort()
    )
  })

  it('已有完整位置候选时 addSeat 会真正追加目标座位候选', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [0, 2, 7] })
    const card = getCard(room, 1)
    const seatZeroHand = playerLocation(0, 'hand')
    const seatSevenHand = playerLocation(7, 'hand')
    const seatTwoHand = playerLocation(2, 'hand')

    card.confirmKnown()
    card.setLocationCandidates([seatZeroHand, seatSevenHand])

    expect(card.addSeat(2, 'test:add-seat-with-location-candidates')).toBe(true)
    expect(locationKeys(card)).toEqual(
      [
        createLocationCandidateKey(seatZeroHand),
        createLocationCandidateKey(seatTwoHand),
        createLocationCandidateKey(seatSevenHand)
      ].sort()
    )
    expect(
      Array.from(card.seats)
        .map((seatID) => Number(seatID))
        .sort((a, b) => a - b)
    ).toEqual([0, 2, 7])
  })
})
