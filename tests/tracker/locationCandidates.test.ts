import { describe, expect, it } from 'vitest'
import { ConstraintGroup } from '@/tracker/constraint/ConstraintGroup'
import {
  createLocationCandidateKey,
  parseLocationCandidateKey
} from '@/tracker/candidate/locationCandidate'
import { createTestRoom, getCard } from './helpers/room'
import {
  equipmentContainer,
  locationKeys,
  outsideLocation,
  playerLocation,
  publicLocation
} from './helpers/locationCandidates'

describe('完整位置候选回归', () => {
  it.each([
    { key: 'popup:3544', expected: { type: 'popup', spaceID: 3544 } },
    {
      key: 'player:0:mark:0',
      expected: { type: 'player', seatID: 0, subZone: 'mark', spellID: 0 }
    },
    {
      key: 'player:3:hand:none',
      expected: { type: 'player', seatID: 3, subZone: 'hand', spellID: null }
    },
    {
      key: 'public:pile:top:3',
      expected: { type: 'public', zone: 'pile', position: 'top', count: 3, label: null }
    },
    {
      key: 'public:pile:top:any',
      expected: { type: 'public', zone: 'pile', position: 'top', count: null, label: null }
    },
    {
      key: 'container:equipment:161:700',
      expected: { type: 'container', containerType: 'equipment', cardID: 161, spellID: 700 }
    }
  ])('字符串位置键 $key 解析为数字字段并保留未知范围', ({ key, expected }) => {
    const candidate = parseLocationCandidateKey(key)
    expect(candidate).toEqual(expected)
    expect(createLocationCandidateKey(candidate)).toBe(key)
  })

  it.each([false, true])('旧组座位快照不裁剪共享牌的新位置（逆序收敛：%s）', (reverse) => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [0, 3] })
    const cards = [getCard(room, 1)!, getCard(room, 2)!]
    const mark = playerLocation(0, 'mark', 3657)
    const hand = playerLocation(3, 'hand')
    cards.forEach((card) => card.bindCandidates([0], 'mark', 3657, { known: true }))
    const oldGroup = room.createConstraintGroup({ cards, candidateSeats: [0] })
    cards.forEach((card) => card.setLocationCandidates([mark, hand]))
    const newGroup = room.createConstraintGroup({
      cards,
      candidateSeats: [0, 3],
      expectedSlotsByLocation: new Map([
        [createLocationCandidateKey(mark), 1],
        [createLocationCandidateKey(hand), 1]
      ])
    })
    const groups = reverse ? [newGroup, oldGroup] : [oldGroup, newGroup]
    groups.forEach((group) => group.resolve())
    cards.forEach((card) => {
      expect(card.hasLocationCandidate(mark)).toBe(true)
      expect(card.hasLocationCandidate(hand)).toBe(true)
      expect(card.owner).toBeNull()
    })
    expect(oldGroup.candidateSeats).toEqual(new Set([0]))
    groups.forEach((group) => expect(group.resolve()).toBe(false))
  })

  it('候选落定与重复写入保持幂等，并通知所有失去候选的座位', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [0, 3] })
    const card = getCard(room, 1)!
    const mark = playerLocation(0, 'mark', 3657)
    const hand = playerLocation(3, 'hand')
    card.bindCandidates([0], 'mark', 3657, { known: true })
    card.setLocationCandidates([mark, hand])
    const eventStart = room.dirtyCardEvents.length

    expect(card.setLocationCandidates([hand])).toBe(true)
    expect(card.locationCandidates).toEqual([])
    expect(card.seats).toEqual(new Set([3]))
    expect(card.owner).toBe(3)
    expect(card.subZone).toBe('hand')
    expect(card.spellID).toBeNull()
    expect(room.dirtyCardEvents.slice(eventStart).map((event) => event.detail)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          previousSeats: expect.arrayContaining([0, 3]),
          previousSeatSize: 2,
          nextSeatSize: 1
        })
      ])
    )
    const settledEvents = room.dirtyCardEvents.length
    expect(card.setLocationCandidates([hand])).toBe(false)
    expect(card.setSeats([3])).toBe(false)
    expect(room.dirtyCardEvents).toHaveLength(settledEvents)
  })

  it('标记、弹窗、手牌与公共区切换清理位置字段，重置时清零时间戳', () => {
    const { room, gameState } = createTestRoom({ cardIDs: [1], seatIDs: [0, 3] })
    const card = getCard(room, 1)!
    gameState.turn = 2
    gameState.round = 3
    gameState.phase = 4
    card.resolveLocationCandidate(playerLocation(0, 'mark', 414))
    expect(room.getPublicZone('pile').cards).not.toContain(card)
    expect(card.spellID).toBe(414)

    card.resolveLocationCandidate({ type: 'popup', spaceID: 3544 })
    expect(card.location).toBe('popup')
    expect(card.popupSpaceID).toBe(3544)
    expect(card.subZone).toBeNull()
    expect(card.spellID).toBeNull()
    expect(card.owner).toBeNull()

    card.bindCandidates(3, 'hand')
    expect(card.popupSpaceID).toBeNull()
    expect(card.owner).toBe(3)
    card.moveToPublicZone('discard')
    expect(card.locationCandidates).toEqual([])
    expect(card.subZone).toBeNull()
    expect(card.spellID).toBeNull()
    expect(card.seats.size).toBe(0)
    expect(card.isKnown).toBe(true)
    expect([card.turn, card.round, card.phase]).toEqual([2, 3, 4])

    card.resolveLocationCandidate({ type: 'popup', spaceID: 3544 })
    room.refreshPlayerSnapshot()
    const eventStart = room.dirtyCardEvents.length
    card.reset()
    expect(card.location).toBe('pile')
    expect(card.popupSpaceID).toBeNull()
    expect(card.isKnown).toBe(false)
    expect(card.suspended).toBe(false)
    expect([card.turn, card.round, card.phase]).toEqual([0, 0, 0])
    expect(room.dirtyCardEvents.slice(eventStart)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ card, detail: expect.objectContaining({ type: 'card-reset' }) })
      ])
    )
  })

  it('玩家与公共候选共存时保留候选并清理公共区引用', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [0, 3] })
    const card = getCard(room, 1)!
    const hand = playerLocation(0, 'hand')
    const mark = playerLocation(3, 'mark', 414)
    const pileTop = publicLocation('pile', 'top', 2)
    card.setLocationCandidates([hand, pileTop])
    expect(card.location).toBe('player')
    expect(room.getPublicZone('pile').cards).not.toContain(card)
    expect(card.hasLocationCandidate(pileTop)).toBe(true)
    expect(room.publicZones.getPublicZoneConsistencyIssues()).toEqual([])
    card.setLocationCandidates([hand, mark])
    expect(room.getPublicZone('pile').cards).not.toContain(card)
    expect(card.hasLocationCandidate(hand)).toBe(true)
    expect(card.hasLocationCandidate(mark)).toBe(true)
  })

  it('无玩家候选时容器与公共候选共存仍保留公共区引用', () => {
    const { room } = createTestRoom({ cardIDs: [1, 161], seatIDs: [0] })
    const card = getCard(room, 1)!
    const container = equipmentContainer(161, 700)
    const pileTop = publicLocation('pile', 'top', 2)

    card.setLocationCandidates([container, pileTop])
    expect(room.getPublicZone('pile').cards).toContain(card)
    expect(card.hasLocationCandidate(container)).toBe(true)
    expect(card.hasLocationCandidate(pileTop)).toBe(true)

    card.setLocationCandidates([container])
    expect(room.getPublicZone('pile').cards).not.toContain(card)
    expect(card.hasLocationCandidate(container)).toBe(true)
  })

  it('期望槽位解析区分已落定位置与同 owner 下仍未决的多个位置', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [0] })
    const card = getCard(room, 1)!
    const hand = playerLocation(0, 'hand')
    const mark = playerLocation(0, 'mark', 0)
    expect(room.constraints.getResolvedExpectedLocationCandidate(card)).toBeNull()

    card.bindCandidates([0], 'hand')
    expect(room.constraints.getResolvedExpectedLocationCandidate(card)).toEqual(hand)
    card.setLocationCandidates([hand, mark])
    expect(card.owner).toBe(0)
    expect(room.constraints.getResolvedExpectedLocationCandidate(card)).toBeNull()
    card.resolveLocationCandidate(mark)
    expect(room.constraints.getResolvedExpectedLocationCandidate(card)).toEqual(mark)
    card.moveToPublicZone('discard')
    expect(room.constraints.getResolvedExpectedLocationCandidate(card)).toBeNull()
  })

  it.each([
    { name: '公共端点', candidate: publicLocation('pile', 'top', 2) },
    { name: '装备容器', candidate: equipmentContainer(161, 700) },
    { name: '场外位置', candidate: outsideLocation() }
  ])('期望槽位解析直接保留唯一$name候选，不退化为玩家子区', ({ candidate }) => {
    const { room } = createTestRoom({ cardIDs: [1] })
    const card = getCard(room, 1)!
    card.setLocationCandidates([candidate])
    expect(room.constraints.getResolvedExpectedLocationCandidate(card)).toBe(
      card.locationCandidates[0]
    )
  })

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
    expect(card.subZoneCandidates).toHaveLength(2)
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

  it('重叠约束组重复 apply 不驱动 resolve 重循环', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    const firstGroup = new ConstraintGroup({ id: 'test:overlap-a', cards: [card] })
    const secondGroup = new ConstraintGroup({ id: 'test:overlap-b', cards: [card] })

    firstGroup.apply()
    secondGroup.apply()

    // 同一张牌可同时属于多个组，重复 apply 不能报告虚假的状态变化。
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
      expect(card.locationCandidates).toEqual([])
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
