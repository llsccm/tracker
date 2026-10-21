import { describe, expect, it, vi } from 'vitest'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import type { Room } from '@/tracker/Room'
import { getPlayerHandCardsBySeat } from '@/tracker/room/movement/sourceQueries'
import { createTestRoom, getCard } from './helpers/room'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'
import { trackerLogger } from '@/utils/logger'

/** 复现“第三视角观测标记区暗牌进入手牌”的原始协议。 */
function moveHiddenMarkToHand(
  room: Room,
  options: { fromSeatID: number; toSeatID: number; fromZoneParam: number; spellID: number }
) {
  const event = normalizeMoveEvent({
    CardCount: 1,
    CardIDs: [],
    FromID: options.fromSeatID,
    FromPosition: 65282,
    FromZone: 4,
    FromZoneParam: options.fromZoneParam,
    MoveType: 27,
    SpellID: options.spellID,
    ToID: options.toSeatID,
    ToPosition: 65280,
    ToZone: 5,
    ToZoneParam: 0
  })
  room.moveCards(event.cardIDs, event.toZone, event.options)
}

function bindMarkCards(room: Room, cardIDs: number[], seatID: number, spellID: number) {
  const cards = cardIDs.map((cardID) => getCard(room, cardID)!)
  room.clearCardsFromPublicZones(cards)
  cards.forEach((card) => card.bindCandidates([seatID], 'mark', spellID, { known: true }))
  return cards
}

describe('标记区暗牌进入手牌', () => {
  it.each([{ discardIDs: [92, 111, 96] }, { discardIDs: [96, 92, 111] }])(
    '控制器按手牌协议弃置标记候选与匿名手牌，不受揭示顺序影响：$discardIDs',
    ({ discardIDs }) => {
      const { controller } = createTrackerControllerHarness()
      controller.initTrackerRoom()
      controller.registerTrackerPlayers([{ SeatID: 0, ClientID: 100 }, { SeatID: 3 }], 100)
      // 97 仅作为第二张标记明牌的夹具身份；其余 ID 来自问题协议。
      controller.initTrackerDeck([92, 111, 96, 97, 31275])
      const room = controller.getTrackerRoom()!
      const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})
      try {
        controller.syncTrackerMove(
          protocolMove({
            CardIDs: [96, 97],
            CardCount: 2,
            ToZone: 4,
            ToID: 0,
            ToZoneParam: 3657,
            SpellID: 3657,
            MoveType: 19
          })
        )
        controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 2, ToID: 3 }))
        controller.syncTrackerMove(protocolMove({ CardIDs: [31275], ToZone: 6, ToID: 3 }))
        const anonymousHand = getPlayerHandCardsBySeat(room, 3).filter((card) => card.isAnonymous)
        expect(anonymousHand).toHaveLength(2)
        controller.syncTrackerMove(
          protocolMove({
            CardIDs: [],
            CardCount: 1,
            FromID: 0,
            FromZone: 4,
            FromZoneParam: 3657,
            FromPosition: 65282,
            MoveType: 27,
            SpellID: 3658,
            ToID: 3
          })
        )
        const candidate = room.cardIndex.get(96)!
        expect(candidate.subZone).toBe('mark')
        expect(candidate.getPossibleLocations()).toEqual(
          expect.arrayContaining([
            { type: 'player', seatID: 0, subZone: 'mark', spellID: 3657 },
            { type: 'player', seatID: 3, subZone: 'hand', spellID: null }
          ])
        )
        expect(room.getPlayer(3).observedHandCount).toBe(3)

        controller.syncTrackerMove(
          protocolMove({
            CardIDs: [31275],
            FromID: 3,
            FromZone: 6,
            FromPosition: 65282,
            MoveType: 4,
            ToID: 255,
            ToZone: 12
          })
        )
        expect(room.getPlayer(3).observedHandCount).toBe(3)
        const entityCountBefore = room.cards.length
        controller.syncTrackerMove(
          protocolMove({
            CardIDs: discardIDs,
            CardCount: 3,
            FromID: 3,
            FromZone: 5,
            FromPosition: 65282,
            MoveType: 4,
            ToID: 255,
            ToZone: 2
          })
        )

        expect(room.cards).toHaveLength(entityCountBefore)
        expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual(discardIDs)
        expect(anonymousHand).toContain(room.cardIndex.get(92))
        expect(anonymousHand).toContain(room.cardIndex.get(111))
        expect(room.getPlayer(3).observedHandCount).toBe(0)
        expect(getPlayerHandCardsBySeat(room, 3)).toEqual([])
        expect(room.cardIndex.get(97)).toMatchObject({
          location: 'player',
          owner: 0,
          subZone: 'mark',
          spellID: 3657
        })
        expect(
          room.locationIndex.markBySeatAndSpell
            .get(0)
            ?.get(3657)
            ?.map((card) => card.id)
        ).toEqual([97])
        expect(room.assertPileIdentityLedgerConsistency('test:mark-to-hand-discard')).toEqual([])
        expect(warnSpy).not.toHaveBeenCalled()
      } finally {
        warnSpy.mockRestore()
        controller.destroyTrackerRoom()
      }
    }
  )

  it('可见牌多于协议张数时建立标记/手牌双边候选', () => {
    const { room } = createTestRoom({ cardIDs: [11, 12], seatIDs: [0, 3] })
    const [firstMark, secondMark] = bindMarkCards(room, [11, 12], 0, 3657)

    moveHiddenMarkToHand(room, { fromSeatID: 0, toSeatID: 3, fromZoneParam: 3657, spellID: 3658 })

    const markKey = createLocationCandidateKey({
      type: 'player',
      seatID: 0,
      subZone: 'mark',
      spellID: 3657
    })
    const handKey = createLocationCandidateKey({
      type: 'player',
      seatID: 3,
      subZone: 'hand',
      spellID: null
    })

    // 两张可见牌都保留原标记候选，并新增目标手牌候选；不能被“挑一张”固定。
    ;[firstMark, secondMark].forEach((card) => {
      expect(card.isKnown).toBe(true)
      expect(card.hasLocationCandidate(markKey)).toBe(true)
      expect(card.hasLocationCandidate(handKey)).toBe(true)
    })

    // 3 号位候选手牌区应展示这两张候选，数量约束由组内 hand 名额承担。
    expect(room.locationIndex.candidateHandBySeat.get(3) ?? []).toHaveLength(2)
    expect(getPlayerHandCardsBySeat(room, 3)).toHaveLength(0)

    const group = Array.from(room.constraintGroups.values()).find(
      (item) => item.cards.has(firstMark) && item.expectedSlotsByLocation.size === 2
    )
    expect(group?.expectedSlotsByLocation.get(markKey)).toBe(1)
    expect(group?.expectedSlotsByLocation.get(handKey)).toBe(1)
  })

  it('标记区只有唯一可见牌时仍按唯一解取出', () => {
    const { room } = createTestRoom({ cardIDs: [11, 12], seatIDs: [0, 3] })
    const [onlyMark] = bindMarkCards(room, [11], 0, 3657)

    moveHiddenMarkToHand(room, { fromSeatID: 0, toSeatID: 3, fromZoneParam: 3657, spellID: 3658 })

    expect(onlyMark.location).toBe('player')
    expect(onlyMark.subZone).toBe('hand')
    expect(onlyMark.seats.has(3)).toBe(true)
    expect(onlyMark.isKnown).toBe(true)
  })

  it('暗置交出的牌从手牌离开后不制造标记区幽灵占位', () => {
    const { room } = createTestRoom({ cardIDs: [11, 12], seatIDs: [0, 3] })
    const [firstMark, secondMark] = bindMarkCards(room, [11, 12], 0, 3657)

    moveHiddenMarkToHand(room, { fromSeatID: 0, toSeatID: 3, fromZoneParam: 3657, spellID: 3658 })

    // 真实被交出的那张从 3 号位手牌弃置：协议明牌来源为 hand，本地仍记在 mark。
    room.moveCards([12], 'discard', {
      fromZone: null,
      fromSeatID: 3,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'test:hand-discard' }
    })

    expect(secondMark.location).toBe('discard')
    expect(firstMark.location).toBe('player')
    expect(firstMark.subZone).toBe('mark')
    expect(firstMark.seats.has(0)).toBe(true)

    const markEntities = room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'mark'
    )
    expect(markEntities).toHaveLength(1)
    expect(markEntities[0]?.id).toBe(11)
    expect(getPlayerHandCardsBySeat(room, 3)).toHaveLength(0)

    // 参与牌离场后只剩唯一候选，数量约束应该收敛成确定标记牌。
    const handKey = createLocationCandidateKey({
      type: 'player',
      seatID: 3,
      subZone: 'hand',
      spellID: null
    })
    expect(firstMark.hasLocationCandidate(handKey)).toBe(false)
  })

  it('标记区交牌后替换旧数量约束并保留目标手牌候选', () => {
    const { room } = createTestRoom({ cardIDs: [11, 12, 21], seatIDs: [0, 3] })
    const [firstMark, secondMark] = bindMarkCards(room, [11, 12], 0, 3657)
    const markKey = createLocationCandidateKey({
      type: 'player',
      seatID: 0,
      subZone: 'mark',
      spellID: 3657
    })
    const handKey = createLocationCandidateKey({
      type: 'player',
      seatID: 3,
      subZone: 'hand',
      spellID: null
    })

    // 模拟暗置标记区账本已建的组：candidateSeats 只含标记座位 0。
    room.createConstraintGroup({
      cards: [firstMark, secondMark],
      candidateSeats: [0],
      expectedSlotsByLocation: new Map([[markKey, 2]]),
      known: true,
      sourceEvent: { type: 'test:hiddenMarkLedger' }
    })

    moveHiddenMarkToHand(room, { fromSeatID: 0, toSeatID: 3, fromZoneParam: 3657, spellID: 3658 })

    // 原来的 mark=2 已经过期，新组应表达 mark=1、hand@3=1。
    ;[firstMark, secondMark].forEach((card) => {
      expect(card.seats.has(3)).toBe(true)
      expect(card.hasLocationCandidate(markKey)).toBe(true)
      expect(card.hasLocationCandidate(handKey)).toBe(true)
    })
    expect(room.locationIndex.candidateHandBySeat.get(3) ?? []).toHaveLength(2)
  })
})

it('旧组只移除部分牌时先按原位置扣名额，再扩展目标候选', () => {
  const { room } = createTestRoom({ cardIDs: [11, 12, 21], seatIDs: [0, 1, 3] })
  const movedCards = bindMarkCards(room, [11, 12], 0, 3657)
  const [otherMark] = bindMarkCards(room, [21], 1, 3657)
  const sourceKey = createLocationCandidateKey({
    type: 'player',
    seatID: 0,
    subZone: 'mark',
    spellID: 3657
  })
  const otherKey = createLocationCandidateKey({
    type: 'player',
    seatID: 1,
    subZone: 'mark',
    spellID: 3657
  })
  const oldGroup = room.createConstraintGroup({
    cards: [...movedCards, otherMark],
    candidateSeats: [0, 1],
    expectedSlotsByLocation: new Map([
      [sourceKey, 2],
      [otherKey, 1]
    ])
  })

  moveHiddenMarkToHand(room, { fromSeatID: 0, toSeatID: 3, fromZoneParam: 3657, spellID: 3658 })

  expect(Array.from(oldGroup.cards, (card) => card.id)).toEqual([21])
  expect(oldGroup.expectedSlotsByLocation.get(sourceKey)).toBe(0)
  expect(oldGroup.expectedSlotsByLocation.get(otherKey)).toBe(1)
  expect(otherMark.owner).toBe(1)
  expect(otherMark.subZone).toBe('mark')
  expect(room.getPlayer(3)!.getCandidateHandSlotCount()).toBe(1)
})
