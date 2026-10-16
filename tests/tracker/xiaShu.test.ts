import { moveContext } from './helpers/moveContext'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applySpellEffect } from '@/handler/spellEffects'
import handleXiaShuMove, {
  handleXiaShuChoice,
  handleXiaShuTargetNotice
} from '@/handler/skills/XiaShu'
import { Game } from '@/tracker'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { createTestRoom, getCard } from './helpers/room'

const { revealTrackerCards } = vi.hoisted(() => ({ revealTrackerCards: vi.fn() }))

vi.mock('@/tracker/runtime/browser', () => ({
  tracker: { revealTrackerCards }
}))

afterEach(() => {
  revealTrackerCards.mockReset()
  Game.deleteSpellState(361)
})

describe('下书', () => {
  it('选择回复先于移动时由通用转移收敛四张暗牌和一个候选槽', () => {
    const shownCardIDs = [96, 131, 41, 55, 40]
    const hiddenCardIDs = [130, 132, 135, 136]
    const candidateCardIDs = [133, 134]
    const allCardIDs = [...shownCardIDs, ...hiddenCardIDs, ...candidateCardIDs]
    const { room } = createTestRoom({ cardIDs: allCardIDs, seatIDs: [3, 6, 7] })

    try {
      const sourceCards = allCardIDs.map((cardID) => getCard(room, cardID))
      room.clearCardsFromPublicZones(sourceCards)
      sourceCards.forEach((card) => {
        if (candidateCardIDs.includes(card.id)) {
          card.bindCandidates([7, 6], 'hand', null, { known: true })
          return
        }

        card.bindCandidates([7], 'hand', null, { known: shownCardIDs.includes(card.id) })
        if (!hiddenCardIDs.includes(card.id)) return

        card.isKnown = false
        room.notifyCardChanged(card, { type: 'test:xiaShu-hidden-card' })
      })

      const targetHandKey = createLocationCandidateKey({
        type: 'player',
        seatID: 7,
        subZone: 'hand',
        spellID: null
      })
      const actorHandKey = createLocationCandidateKey({
        type: 'player',
        seatID: 3,
        subZone: 'hand',
        spellID: null
      })
      const otherHandKey = createLocationCandidateKey({
        type: 'player',
        seatID: 6,
        subZone: 'hand',
        spellID: null
      })

      // 两张候选实体共同表达“7 号位一张、6 号位一张”，但具体身份未知。
      // 因此 7 号位有 5 明 + 4 暗 + 1 候选槽，共 10 张手牌、11 个候选实体。
      room.createConstraintGroup({
        id: 'xia-shu-existing-candidate-group',
        cards: candidateCardIDs.map((cardID) => getCard(room, cardID)),
        candidateSeats: [7, 6],
        expectedSlotsBySeat: new Map([
          [7, 1],
          [6, 1]
        ]),
        expectedSlotsByLocation: new Map([
          [targetHandKey, 1],
          [otherHandKey, 1]
        ]),
        known: true,
        sourceEvent: { type: 'test:xiaShu-existing-candidate-group' }
      })
      room.getPlayer(7).syncObservedHandCount(10)
      room.getPlayer(6).syncObservedHandCount(1)
      room.getPlayer(3).syncObservedHandCount(0)
      room.resolveConstraints()

      revealTrackerCards.mockImplementation(
        (
          target: {
            seatID?: number
            handMoveCount?: number
            sourceEvent?: { type: string; label?: string }
          },
          cardIDs: number[]
        ) => {
          room.moveCards(cardIDs, 'player', {
            toSeatID: Number(target.seatID),
            fromSeatID: Number(target.seatID),
            fromZone: null,
            fromSubZone: 'hand',
            subZone: 'hand',
            cardCount: cardIDs.length,
            handMoveCount: Number(target.handMoveCount),
            sourceEvent: target.sourceEvent
          })
        }
      )

      handleXiaShuTargetNotice({
        Param: 0,
        Params: shownCardIDs,
        SeatID: 3,
        SpellID: 361,
        SrcSeatID: 3,
        targetSeatID: 7,
        Type: 29
      })
      // 实测 CGsRoleSpellOptRep 先于后续取牌 PubGsCMoveCard 到达。
      handleXiaShuChoice({
        Datas: [2, 1],
        SeatID: 3,
        SpellID: 361,
        Type: 22,
        data_count: 2
      })

      const afterMoveCallbacks: (() => void)[] = []
      applySpellEffect({
        game: Game,
        afterMove(callback: () => void) {
          afterMoveCallbacks.push(callback)
        },
        ...moveContext({
          SpellID: 361,
          CardIDs: [0, 0, 0, 0, 0],
          CardCount: 5,
          FromID: 7,
          ToID: 3,
          FromZone: 5,
          ToZone: 5,
          MoveType: 5
        })
      })

      room.moveCards([], 'player', {
        fromZone: null,
        fromSeatID: 7,
        fromSubZone: 'hand',
        toSeatID: 3,
        subZone: 'hand',
        cardCount: 5,
        sourceEvent: { type: 'test:xiaShu-hidden-transfer' }
      })

      expect(room.getPlayer(7).observedHandCount).toBe(5)
      expect(room.getPlayer(3).observedHandCount).toBe(5)
      expect(afterMoveCallbacks).toHaveLength(1)
      afterMoveCallbacks[0]()

      shownCardIDs.forEach((cardID) => {
        expect(Array.from(getCard(room, cardID).seats)).toEqual([7])
      })
      hiddenCardIDs.forEach((cardID) => {
        expect(Array.from(getCard(room, cardID).seats)).toEqual([3])
        expect(getCard(room, cardID).isKnown).toBe(false)
      })
      candidateCardIDs.forEach((cardID) => {
        expect(Array.from(getCard(room, cardID).seats).sort()).toEqual([3, 6])
      })

      // 通用转移会失效旧组中已被取走的 7 号位手牌名额，但保留 6 号位原有约束；
      // 新建的转移组再负责“3 号位恰有 5 张”这一事实，无需下书手工重建旧组。
      const existingGroup = room.constraintGroups.get('xia-shu-existing-candidate-group')
      expect(existingGroup?.expectedSlotsBySeat.get(7)).toBeUndefined()
      expect(existingGroup?.expectedSlotsBySeat.get(3)).toBeUndefined()
      expect(existingGroup?.expectedSlotsBySeat.get(6)).toBe(1)
      expect(existingGroup?.expectedSlotsByLocation.get(targetHandKey)).toBeUndefined()
      expect(existingGroup?.expectedSlotsByLocation.get(actorHandKey)).toBeUndefined()
      expect(existingGroup?.expectedSlotsByLocation.get(otherHandKey)).toBe(1)

      const transferGroup = Array.from(room.constraintGroups.values()).find(
        (group) =>
          (group.sourceEvent as { type?: string } | null)?.type === 'test:xiaShu-hidden-transfer'
      )
      expect(transferGroup?.expectedSlotsBySeat.get(7)).toBe(0)
      expect(transferGroup?.expectedSlotsBySeat.get(3)).toBe(5)
      expect(transferGroup?.expectedSlotsByLocation.get(targetHandKey)).toBe(0)
      expect(transferGroup?.expectedSlotsByLocation.get(actorHandKey)).toBe(5)
      expect(Game.getSpellState(361)).toBeUndefined()
    } finally {
      room.destroy()
    }
  })

  it.each([
    ['同区展示', { FromZone: 5, ToZone: 5, FromID: 7, ToID: 7 }],
    ['标记区来源', { FromZone: 4, ToZone: 5, FromID: 7, ToID: 3 }]
  ])('移动位置为%s时不注册下书回调', (_label, move) => {
    Game.setSpellState(361, { shownCardIDs: [96], targetSeatID: 7, choice: 2, actorSeatID: 3 })
    const callbacks: (() => void)[] = []

    handleXiaShuMove({
      ...moveContext({
        FromPosition: POSITION_RANDOM,
        ToPosition: POSITION_TOP,
        FromZoneParam: 0,
        ToZoneParam: 0,
        ...move,
        CardIDs: [0],
        MoveType: 5,
        SpellID: 361,
        CardCount: 1
      }),
      game: Game,
      afterMove(callback: () => void) {
        callbacks.push(callback)
      }
    })

    expect(callbacks).toHaveLength(0)
  })
})
