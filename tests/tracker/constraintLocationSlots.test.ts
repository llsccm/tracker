import { describe, expect, it } from 'vitest'
import { ConstraintGroup } from '@/tracker/ConstraintGroup'
import type { Room } from '@/tracker/Room'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { createTestRoom, getCard } from './helpers/room'
import { equipmentContainer, playerLocation, publicLocation } from './helpers/locationCandidates'

function verifyLocationSlotContract(room: Room, group: ConstraintGroup): void {
  // @ts-expect-error 已退役座位名额存储和输入，统一使用完整位置。
  void group.expectedSlotsBySeat
  // @ts-expect-error 约束组不能再接受座位名额输入糖。
  new ConstraintGroup({ expectedSlotsBySeat: new Map() })
  // @ts-expect-error Room 门面同样只接受完整位置名额。
  room.createConstraintGroup({ expectedSlotsBySeat: new Map() })
  // @ts-expect-error 已退役子区槽位输入，统一使用完整位置名额。
  new ConstraintGroup({ expectedSlotsBySubZone: new Map() })
  // @ts-expect-error Room 门面不能绕过完整位置输入契约。
  room.createConstraintGroup({ expectedSlotsBySubZone: new Map() })
  // @ts-expect-error 行为模块同样不接受子区槽位输入。
  room.constraints.createConstraintGroup({ expectedSlotsBySubZone: new Map() })
  // @ts-expect-error 约束组不再保留子区槽位镜像。
  void group.expectedSlotsBySubZone
}

void verifyLocationSlotContract

describe('完整位置名额生命周期', () => {
  it('完整位置名额支持对象输入与多子区更新', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)!
    card.bindCandidates([1, 2], 'hand', null, { known: true })
    const group = room.createConstraintGroup({
      id: 'location-input',
      cards: [card],
      expectedSlotsByLocation: { 'player:1:hand:none': 1, 'player:2:hand:none': 0 }
    })
    expect(group.expectedSlotsByLocation).toEqual(
      new Map([
        ['player:1:hand:none', 1],
        ['player:2:hand:none', 0]
      ])
    )
    expect(group).not.toHaveProperty('expectedSlotsBySeat')
    room.constraintGroupsDirty = false
    room.createConstraintGroup({
      id: group.id,
      expectedSlotsByLocation: undefined
    })
    expect(group.expectedSlotsByLocation.get('player:1:hand:none')).toBe(1)
    expect(room.constraintGroupsDirty).toBe(false)

    const markKey = createLocationCandidateKey(playerLocation(1, 'mark', 700))
    room.createConstraintGroup({
      id: group.id,
      expectedSlotsByLocation: new Map([
        ['player:1:hand:none', 2],
        [markKey, 1]
      ])
    })
    expect(group.expectedSlotsByLocation).toEqual(
      new Map([
        ['player:1:hand:none', 2],
        [markKey, 1]
      ])
    )
    room.createConstraintGroup({
      id: group.id,
      expectedSlotsByLocation: new Map([
        [markKey, 1],
        ['player:2:hand:none', 1]
      ])
    })
    expect(group.expectedSlotsByLocation).toEqual(
      new Map([
        [markKey, 1],
        ['player:2:hand:none', 1]
      ])
    )
    room.createConstraintGroup({ id: group.id, expectedSlotsByLocation: new Map([[markKey, 1]]) })
    expect(group.expectedSlotsByLocation).toEqual(new Map([[markKey, 1]]))
  })

  it('候选计数先扣除组内确定牌，匿名对账只补剩余缺口', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const cards = [1, 2, 3].map((id) => getCard(room, id)!)
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 700)
    room.clearCardsFromPublicZones(cards)
    cards.forEach((card) => card.bindCandidates([1], 'hand', null, { known: true }))
    cards.slice(1).forEach((card) => card.setLocationCandidates([hand, mark]))
    room.createConstraintGroup({
      cards,
      expectedSlotsByLocation: new Map([[createLocationCandidateKey(hand), 2]])
    })
    const player = room.getPlayer(1)!
    expect(player.getCandidateHandSlotCount()).toBe(1)
    player.syncObservedHandCount(3)
    room.resolveConstraints()
    expect(player.unknownCardCount).toBe(1)
    expect(room.cards.filter((card) => card.location === 'player' && !card.isKnown)).toHaveLength(1)
    expect(player.observedHandCount).toBe(3)
  })

  it('完整手牌名额限制同 owner 的手牌和标记候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2] })
    const cards = [1, 2].map((id) => getCard(room, id)!)
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 700)
    cards.forEach((card) => {
      card.confirmKnown()
      card.setLocationCandidates([hand, mark])
    })
    room.createConstraintGroup({
      cards,
      expectedSlotsByLocation: new Map([[createLocationCandidateKey(hand), 1]])
    })
    expect(room.getPlayer(1)!.getCandidateHandSlotCount()).toBe(1)
  })

  it.each([false, true])('重叠组同时限制明牌槽位，不重复累计身份（逆序建组：%s）', (reverse) => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const cards = [1, 2, 3].map((id) => getCard(room, id)!)
    cards.forEach((card) => card.bindCandidates([1, 2], 'hand', null, { known: true }))
    const groups = [
      [cards[0], cards[1]],
      [cards[1], cards[2]],
      [cards[0], cards[2]]
    ]
    if (reverse) groups.reverse()
    groups.forEach((groupCards) =>
      room.createConstraintGroup({
        cards: groupCards,
        expectedSlotsByLocation: new Map([[playerLocation(1, 'hand'), 1]])
      })
    )
    // 三对身份分别最多一张在 1 号手牌，三个身份中同时在手牌的最多只能有一张。
    expect(room.getPlayer(1)!.getCandidateHandSlotCount()).toBe(1)
  })

  it('相交与不相交组的候选容量上界符合小规模穷举', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5, 6], seatIDs: [1, 2] })
    const cards = [1, 2, 3, 4, 5, 6].map((id) => getCard(room, id)!)
    cards.forEach((card) => card.bindCandidates([1, 2], 'hand', null, { known: true }))
    const countBits = (mask: number) => mask.toString(2).replaceAll('0', '').length
    for (let scenario = 1; scenario <= 32; scenario += 1) {
      room.constraintGroups.clear()
      const facts = Array.from({ length: 4 }, (_, index) => {
        const mask = ((scenario * (index + 3) * 17) % 63) + 1
        return { mask, count: countBits(mask & scenario) }
      })
      facts.forEach(({ mask, count }) =>
        room.createConstraintGroup({
          cards: cards.filter((_, index) => (mask & (1 << index)) !== 0),
          expectedSlotsByLocation: new Map([[playerLocation(1, 'hand'), count]])
        })
      )
      const covered = facts.reduce((mask, fact) => mask | fact.mask, 0)
      let expected = 0
      for (let selection = 0; selection < 64; selection += 1) {
        if ((selection & ~covered) !== 0) continue
        if (facts.every((fact) => countBits(selection & fact.mask) <= fact.count)) {
          expected = Math.max(expected, countBits(selection))
        }
      }
      expect(room.getPlayer(1)!.getCandidateHandSlotCount(), `scenario ${scenario}`).toBe(expected)
    }
  })

  it('创建和更新仅维护完整位置名额，省略保持原值、空 Map 明确清空', () => {
    const { room } = createTestRoom({ cardIDs: [1] })
    const card = getCard(room, 1)!
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 700)
    card.confirmKnown()
    card.setLocationCandidates([hand, mark])
    const handKey = createLocationCandidateKey(hand)
    const markKey = createLocationCandidateKey(mark)
    const slots = new Map([
      [handKey, 1],
      [markKey, 0]
    ])
    const group = room.createConstraintGroup({
      id: 'location-slots',
      cards: [card],
      expectedSlotsByLocation: slots
    })

    expect(group.expectedSlotsByLocation).toEqual(slots)
    expect(group.expectedSlotsByLocation).not.toBe(slots)
    expect(group).not.toHaveProperty('expectedSlotsBySubZone')
    room.constraintGroupsDirty = false
    expect(room.createConstraintGroup({ id: group.id })).toBe(group)
    expect(group.expectedSlotsByLocation).toEqual(slots)
    room.createConstraintGroup({
      id: group.id,
      expectedSlotsByLocation: new Map([
        [markKey, 0],
        [handKey, 1]
      ])
    })
    expect(room.constraintGroupsDirty).toBe(false)

    room.createConstraintGroup({
      id: group.id,
      expectedSlotsByLocation: { [handKey]: 0, [markKey]: 1 }
    })
    expect(group.expectedSlotsByLocation).toEqual(
      new Map([
        [handKey, 0],
        [markKey, 1]
      ])
    )
    expect(room.constraintGroupsDirty).toBe(true)
    room.constraintGroupsDirty = false
    room.createConstraintGroup({ id: group.id, expectedSlotsByLocation: new Map() })
    expect(group.expectedSlotsByLocation.size).toBe(0)
    expect(room.constraintGroupsDirty).toBe(true)
    room.constraintGroupsDirty = false
    room.createConstraintGroup({ id: group.id, expectedSlotsByLocation: new Map() })
    expect(room.constraintGroupsDirty).toBe(false)
  })

  it.each([
    { name: '手牌', location: playerLocation(1, 'hand'), remainingSeatSlots: 1 },
    { name: '标记', location: playerLocation(1, 'mark', 700), remainingSeatSlots: 2 },
    { name: '装备容器', location: equipmentContainer(161, 700), remainingSeatSlots: 2 },
    { name: '公共端点', location: publicLocation('pile', 'top', 2), remainingSeatSlots: 2 }
  ])(
    '已锁定$name实体离组只扣减对应位置名额，重复移除不再扣减',
    ({ location, remainingSeatSlots }) => {
      const { room } = createTestRoom({ cardIDs: [1, 2] })
      const cards = [getCard(room, 1)!, getCard(room, 2)!]
      cards.forEach((card) => card.setLocationCandidates([location]))
      const key = createLocationCandidateKey(location)
      const group = room.createConstraintGroup({
        id: 'remove-location-slot',
        cards,
        expectedSlotsByLocation: new Map([
          ['player:1:hand:none', 2],
          [key, 2]
        ])
      })

      expect(room.removeCardsFromConstraintGroups([cards[0]])).toBe(true)
      expect(group.expectedSlotsByLocation.get(key)).toBe(1)
      expect(group.expectedSlotsByLocation.get('player:1:hand:none')).toBe(remainingSeatSlots)
      expect(room.removeCardsFromConstraintGroups([cards[0]])).toBe(false)
      expect(group.expectedSlotsByLocation.get(key)).toBe(1)
      expect(room.removeCardsFromConstraintGroups([cards[1]])).toBe(true)
      expect(group.expectedSlotsByLocation.get(key)).toBe(0)
      expect(room.constraintGroups.has(group.id!)).toBe(false)
    }
  )

  it('同 owner 的未决手牌/标记实体离组不猜测扣减位置名额', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2] })
    const card = getCard(room, 1)!
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 700)
    card.setLocationCandidates([hand, mark])
    const slots = new Map([
      [createLocationCandidateKey(hand), 1],
      [createLocationCandidateKey(mark), 1]
    ])
    const group = room.createConstraintGroup({
      cards: [card, getCard(room, 2)!],
      expectedSlotsByLocation: slots
    })

    expect(card.owner).toBe(1)
    expect(room.removeCardsFromConstraintGroups([card])).toBe(true)
    expect(group.expectedSlotsByLocation).toEqual(slots)
  })

  it.each([false, true])('候选手牌槽只计一次完整位置名额（反向插入位置：%s）', (reverse) => {
    const { room } = createTestRoom({ cardIDs: [1, 2] })
    const cards = [getCard(room, 1)!, getCard(room, 2)!]
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 700)
    cards.forEach((card) => {
      card.confirmKnown()
      card.setLocationCandidates([hand, mark])
    })
    const slots: [string, number][] = [
      [createLocationCandidateKey(hand), 1],
      [createLocationCandidateKey(mark), 1]
    ]
    room.createConstraintGroup({
      cards,
      expectedSlotsByLocation: new Map(reverse ? slots.reverse() : slots)
    })

    expect(room.getPlayer(1)!.getCandidateHandSlotCount()).toBe(1)
  })

  it('随机转移清除来源和目标手牌名额，保留第三方、标记、容器与公共位置', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2, 3] })
    const cards = [getCard(room, 1)!, getCard(room, 2)!]
    const hand = playerLocation(1, 'hand')
    const targetHand = playerLocation(2, 'hand')
    const thirdHand = playerLocation(3, 'hand')
    const mark = playerLocation(1, 'mark', 700)
    const container = equipmentContainer(161, 700)
    const pile = publicLocation('pile', 'top', 2)
    cards.forEach((card) => {
      card.bindCandidates([1], 'hand', null, { known: true })
      card.setLocationCandidates([hand, thirdHand, mark, container, pile])
    })
    const keptSlots = new Map([
      [createLocationCandidateKey(thirdHand), 1],
      [createLocationCandidateKey(mark), 0],
      [createLocationCandidateKey(container), 0],
      [createLocationCandidateKey(pile), 0]
    ])
    const handSlots = new Map([
      [createLocationCandidateKey(hand), 1],
      [createLocationCandidateKey(targetHand), 0]
    ])
    const group = room.createConstraintGroup({
      id: 'mixed-old-slots',
      cards,
      candidateSeats: [1, 3],
      expectedSlotsByLocation: new Map([...keptSlots, ...handSlots])
    })
    const emptyGroup = room.createConstraintGroup({
      id: 'hand-only-old-slots',
      cards,
      expectedSlotsByLocation: handSlots
    })

    expect(
      room.movement.candidates.markRandomHandTransferCandidates({
        fromSeat: 1,
        targetSeat: 2,
        count: 1,
        sourceTotalBefore: 2
      })
    ).toEqual(cards)
    expect(group.expectedSlotsByLocation).toEqual(keptSlots)
    expect(group.expectedSlotsByLocation.get('player:3:hand:none')).toBe(1)
    expect(room.constraintGroups.has(group.id!)).toBe(true)
    expect(room.constraintGroups.has(emptyGroup.id!)).toBe(false)
    room.resolveConstraints()
    expect(group.candidateSeats).toEqual(new Set([1, 3]))
    cards.forEach((card) => expect(card.hasLocationCandidate(targetHand)).toBe(true))
  })
})
