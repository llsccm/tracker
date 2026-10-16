import { describe, expect, it } from 'vitest'
import {
  getKnownHandCardsBySeat,
  getPlayerHandCardsBySeat,
  getUnknownPlayerSourceCards,
  takeUnknownCardsFromPlayer
} from '@/tracker/roomMovement/sourceQueries'
import { HIDDEN_MARK_STATE_KEY } from '@/tracker/roomMovement/types'
import { createTestRoom, getCard } from './helpers/room'

describe('移动组件共享来源查询', () => {
  it('精确来源优先，保持同类实体顺序并支持排除；查询不会移动或收敛实体', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5, 6] })
    const candidate = getCard(room, 1)!
    const exact = getCard(room, 2)!
    const known = getCard(room, 3)!
    const suspended = getCard(room, 4)!
    const otherSeat = getCard(room, 5)!
    const laterExact = getCard(room, 6)!
    room.clearCardsFromPublicZones(room.cards)
    candidate.bindCandidates([1, 2], 'hand')
    exact.bindCandidates([1], 'hand')
    known.bindCandidates([1], 'hand', null, { known: true })
    suspended.bindCandidates([1], 'hand')
    suspended.suspended = true
    otherSeat.bindCandidates([2], 'hand')
    laterExact.bindCandidates([1], 'hand')

    const snapshot = () => ({
      cards: room.cards.map((card) => ({
        id: card.id,
        location: card.location,
        subZone: card.subZone,
        seats: [...card.seats],
        candidates: card.getLocationCandidates(),
        suspended: card.suspended,
        isKnown: card.isKnown
      })),
      dirtySeq: room.dirtyCardSeq,
      constraints: [...room.constraintGroups.keys()],
      hiddenMarks: room.readSkillState(HIDDEN_MARK_STATE_KEY)
    })
    const before = snapshot()

    expect(getUnknownPlayerSourceCards(room, 1)).toEqual([exact, laterExact, candidate])
    expect(getUnknownPlayerSourceCards(room, 1, 'hand', [], [exact])).toEqual([
      laterExact,
      candidate
    ])
    expect(takeUnknownCardsFromPlayer(room, 1, 1)).toEqual([exact])
    expect(takeUnknownCardsFromPlayer(room, 1, 2)).toEqual([exact, laterExact])
    expect(takeUnknownCardsFromPlayer(room, 1, 0)).toEqual([])
    expect(takeUnknownCardsFromPlayer(room, 1, -1)).toEqual([])
    expect(snapshot()).toEqual(before)
    expect(room.readSkillState(HIDDEN_MARK_STATE_KEY)).toBeUndefined()
  })

  it('共享手牌查询区分手牌与标记，并保留明暗实体的读取语义', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
    const known = getCard(room, 1)!
    const unknown = getCard(room, 2)!
    const mark = getCard(room, 3)!
    room.clearCardsFromPublicZones(room.cards)
    known.bindCandidates([1], 'hand', null, { known: true })
    unknown.bindCandidates([1, 2], 'hand')
    mark.bindCandidates([1], 'mark', 700)

    expect(getPlayerHandCardsBySeat(room, 1)).toEqual([known, unknown])
    expect(getKnownHandCardsBySeat(room, 1)).toEqual([known])
    expect(getUnknownPlayerSourceCards(room, 1)).toEqual([unknown])
    expect(getUnknownPlayerSourceCards(room, 1, 'mark', 700)).toEqual([mark])
    expect(getPlayerHandCardsBySeat(room, 2)).toEqual([unknown])
  })

  it('查询实时读取各自 Room，不缓存旧席位或串用另一局实体', () => {
    const { room: firstRoom } = createTestRoom({ cardIDs: [1] })
    const { room: secondRoom } = createTestRoom({ cardIDs: [1] })
    const firstCard = getCard(firstRoom, 1)!
    const secondCard = getCard(secondRoom, 1)!
    firstRoom.clearCardsFromPublicZones([firstCard])
    secondRoom.clearCardsFromPublicZones([secondCard])
    firstCard.bindCandidates([1], 'hand')
    secondCard.bindCandidates([2], 'hand')

    expect(takeUnknownCardsFromPlayer(firstRoom, 1, 1)).toEqual([firstCard])
    expect(takeUnknownCardsFromPlayer(secondRoom, 1, 1)).toEqual([])
    firstCard.bindCandidates([2], 'hand')
    expect(getPlayerHandCardsBySeat(firstRoom, 1)).toEqual([])
    expect(takeUnknownCardsFromPlayer(firstRoom, 2, 1)).toEqual([firstCard])
    expect(takeUnknownCardsFromPlayer(secondRoom, 2, 1)[0]).toBe(secondCard)

    firstRoom.destroy()
    expect(takeUnknownCardsFromPlayer(secondRoom, 2, 1)[0]).toBe(secondCard)
  })
})
