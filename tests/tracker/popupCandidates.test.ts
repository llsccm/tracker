import { describe, expect, it } from 'vitest'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'
import { getPopupSpaceCards } from '@/tracker/room/movement/popupSpaces'
import {
  createLocationCandidateKey,
  parseLocationCandidateKey
} from '@/tracker/candidate/locationCandidate'

function setup(cardIDs: number[]) {
  const { controller } = createTrackerControllerHarness()
  controller.initTrackerRoom()
  controller.registerTrackerPlayers(
    [
      { SeatID: 1, ClientID: 100 },
      { SeatID: 2, ClientID: 200 }
    ],
    100
  )
  controller.initTrackerDeck(cardIDs)
  const move = (
    spell: number,
    from: number,
    to: number,
    ids: number[],
    count = ids.length,
    seat = 2
  ) =>
    controller.syncTrackerMove(
      protocolMove({
        SpellID: spell,
        FromZone: from,
        ToZone: to,
        FromID: from === 8 ? spell : from === 5 ? seat : 255,
        ToID: to === 5 ? seat : 255,
        CardIDs: ids,
        CardCount: count,
        MoveType: to === 2 ? 4 : to === 5 ? 18 : 6
      })
    )
  return { controller, room: controller.getTrackerRoom()!, move }
}

describe('临时弹窗空间通用收敛', () => {
  it('精确组失效后继续暗取仍覆盖全部空间候选并保留旧目标', () => {
    const { room, move } = setup([1, 2, 3])
    move(3544, 1, 8, [1, 2, 3])
    move(3544, 8, 5, [], 1, 2)
    const spaceCards = getPopupSpaceCards(room, 3544)
    room.removeCardsFromConstraintGroups(spaceCards)

    move(3544, 8, 5, [], 1, 1)

    spaceCards.forEach((card) => {
      expect(card.hasLocationCandidate('popup:3544')).toBe(true)
      expect(card.hasLocationCandidate('player:2:hand:none')).toBe(true)
      expect(card.hasLocationCandidate('player:1:hand:none')).toBe(true)
    })
    expect(getPopupSpaceCards(room, 3544)).toEqual(spaceCards)
    const group = Array.from(room.constraintGroups.values()).find((entry) =>
      spaceCards.every((card) => entry.cards.has(card))
    )!
    expect(new Set(group.cards)).toEqual(new Set(spaceCards))
    expect(group.expectedSlotsByLocation.size).toBe(0)
    expect(room.getPlayer(1)!.knownHandCards).toEqual([])
    expect(room.getPlayer(2)!.knownHandCards).toEqual([])
    expect(room.assertPileIdentityLedgerConsistency('popup:weak-successive')).toEqual([])
  })

  it.each([1, 2])('连续暗取更新空间与目标手牌名额，第二次交给座位 %s', (secondSeat) => {
    const { room, move } = setup([1, 2, 3, 4])
    move(3544, 1, 8, [1, 2, 3, 4])
    move(3544, 8, 5, [], 1, 2)
    move(3544, 8, 5, [], 1, secondSeat)

    const group = Array.from(room.constraintGroups.values()).find((entry) =>
      entry.expectedSlotsByLocation.has('popup:3544')
    )!
    expect(group.expectedSlotsByLocation.get('popup:3544')).toEqual({ min: 2, max: 2 })
    expect(group.expectedSlotsByLocation.get('player:2:hand:none')).toEqual({
      min: secondSeat === 2 ? 2 : 1,
      max: secondSeat === 2 ? 2 : 1
    })
    expect(room.getPlayer(secondSeat)!.getCandidateHandSlotCount()).toBe(secondSeat === 2 ? 2 : 1)
    if (secondSeat === 1) {
      expect(group.expectedSlotsByLocation.get('player:1:hand:none')).toEqual({ min: 1, max: 1 })
    }
    expect(room.cards).toHaveLength(4)

    move(3544, 8, 2, [4])
    expect(group.expectedSlotsByLocation.get('popup:3544')).toEqual({ min: 1, max: 1 })
    // 最后一次暗取耗尽空间；身份仍由两个目标的名额决定。
    move(3544, 8, 5, [], 1, 2)
    expect(getPopupSpaceCards(room, 3544)).toEqual([])
    expect(room.getPlayer(2)!.getCandidateHandSlotCount()).toBe(secondSeat === 2 ? 0 : 2)
    if (secondSeat === 2) {
      expect(
        room
          .getPlayer(2)!
          .knownHandCards.map((card) => card.id)
          .sort()
      ).toEqual([1, 2, 3])
    } else {
      move(3544, 5, 2, [1], 1, 1)
      expect(
        room
          .getPlayer(2)!
          .knownHandCards.map((card) => card.id)
          .sort()
      ).toEqual([2, 3])
    }
    room.assertLocationIndexConsistency()
    room.assertAmbiguousKnownIndexConsistency()
    expect(room.assertPileIdentityLedgerConsistency('popup:successive')).toEqual([])
  })

  it.each([
    [1, 3],
    [3, 2],
    [5, 1]
  ])('椒遇暗取 %s 张、分批明弃 %s 张后确认整组', (gain, discard) => {
    const ids = Array.from({ length: gain + discard }, (_, i) => i + 1)
    const { room, move } = setup(ids)
    move(3571, 1, 3, ids)
    move(3571, 3, 8, [], ids.length)
    move(3571, 8, 5, [], gain)
    expect(room.getPlayer(2)!.candidateHandCards).toHaveLength(ids.length)
    expect(room.getPlayer(2)!.getCandidateHandSlotCount()).toBe(gain)
    for (let index = gain; index < ids.length; index++) {
      move(3571, 8, 2, [ids[index]])
      expect(room.getPlayer(2)!.observedHandCount).toBe(gain)
      if (index < ids.length - 1) expect(room.getPlayer(2)!.knownHandCards).toEqual([])
    }
    expect(
      room
        .getPlayer(2)!
        .knownHandCards.map((card) => card.id)
        .sort((a, b) => a - b)
    ).toEqual(ids.slice(0, gain))
    expect(room.getPlayer(2)!.unknownCardCount).toBe(0)
    expect(room.cards).toHaveLength(ids.length)
    expect(getPopupSpaceCards(room, 3571)).toEqual([])
    ids.slice(0, gain).forEach((id) => {
      expect(room.cardIndex.get(id)!.spellID).toBeNull()
      expect(room.cardIndex.get(id)!.hasLocationCandidates()).toBe(false)
    })
    room.assertLocationIndexConsistency()
    room.assertAmbiguousKnownIndexConsistency()
    expect(room.assertPileIdentityLedgerConsistency('popup:gain')).toEqual([])
  })

  it('技能空间相互隔离，连续批次和新 Room 不沿用旧成员', () => {
    const { controller, room, move } = setup([1, 2, 3, 4, 5, 6])
    move(3544, 1, 8, [1, 2])
    move(3571, 1, 8, [3, 4])
    move(3544, 8, 5, [], 1)
    move(3571, 8, 5, [], 1, 1)
    move(3544, 8, 2, [2])
    expect(room.getPlayer(2)!.knownHandCards.map((card) => card.id)).toEqual([1])
    expect(room.getPlayer(1)!.knownHandCards).toEqual([])
    expect(getPopupSpaceCards(room, 3571)).toHaveLength(2)
    move(3544, 1, 8, [5, 6])
    move(3544, 8, 5, [5])
    move(3544, 8, 2, [6])
    move(3571, 8, 2, [4])
    expect(room.getPlayer(1)!.knownHandCards.map((card) => card.id)).toEqual([3])
    expect(
      room
        .getPlayer(2)!
        .knownHandCards.map((card) => card.id)
        .sort()
    ).toEqual([1, 5])
    expect(room.hasSkillState('popupSpaces')).toBe(false)
    room.destroy()
    controller.initTrackerRoom()
    expect(controller.getTrackerRoom()!.hasSkillState('popupSpaces')).toBe(false)
  })

  it('明暗混合空间保持保守，不能套用全明精确名额', () => {
    const { room, move } = setup([1, 2, 3])
    move(3544, 1, 8, [1, 2])
    move(3544, 1, 8, [], 1)
    move(3544, 8, 5, [], 1)
    const player = room.getPlayer(2)!
    expect(player.knownHandCards).toEqual([])
    expect(player.observedHandCount).toBe(1)
    expect(
      Array.from(room.constraintGroups.values()).some((group) =>
        group.expectedSlotsByLocation.has('popup:3544')
      )
    ).toBe(false)
    move(3544, 8, 2, [2])
    expect(player.knownHandCards).toEqual([])
  })

  it('弹窗暗槽明牌揭示原地物化，空间 key 不投影为座位', () => {
    const { room, move } = setup([1, 2])
    move(3544, 1, 8, [], 2)
    const slots = getPopupSpaceCards(room, 3544)
    expect(slots).toHaveLength(2)
    move(3544, 8, 5, [1])
    expect(slots).toContain(room.cardIndex.get(1))
    expect(getPopupSpaceCards(room, 3544)).toHaveLength(1)
    expect(room.cards).toHaveLength(2)
    const location = { type: 'popup' as const, spaceID: 3544 }
    expect(parseLocationCandidateKey(createLocationCandidateKey(location))).toEqual(location)
    expect(getPopupSpaceCards(room, 3544)[0].getPossibleLocations()).toEqual([location])
    expect(getPopupSpaceCards(room, 3544)[0].seats.size).toBe(0)
  })

  it('玩家标记区缺牌时不会挪用同技能的弹窗空间', () => {
    const { room, move } = setup([1, 2])
    move(3544, 1, 8, [], 2)
    const slots = getPopupSpaceCards(room, 3544)
    room.moveCards([], {
      from: { type: 'player', seatID: 1, subZone: 'mark', markSpellID: 3544 },
      to: { type: 'player', seatID: 2, subZone: 'hand' },
      cardCount: 1
    })
    expect(getPopupSpaceCards(room, 3544)).toEqual(slots)
    expect(slots.every((card) => card.location === 'popup' && card.seats.size === 0)).toBe(true)
  })
})
