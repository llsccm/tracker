import { moveContext } from './helpers/moveContext'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { describe, expect, it } from 'vitest'
import { xiaShuPlugin } from '@/tracker/skill/XiaShu'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { createTestRoom, getCard } from './helpers/room'

describe('下书', () => {
  it('选择回复先于移动时由通用转移收敛四张暗牌和一个候选槽', () => {
    const shownCardIDs = [96, 131, 41, 55, 40]
    const hiddenCardIDs = [130, 132, 135, 136]
    const candidateCardIDs = [133, 134]
    const allCardIDs = [...shownCardIDs, ...hiddenCardIDs, ...candidateCardIDs]
    const { room } = createTestRoom({ cardIDs: allCardIDs, seatIDs: [3, 6, 7] })

    room.registerSkillPlugin(xiaShuPlugin)
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

      room.dispatchSkillProtocolEvent({
        type: 'targetNotice',
        message: {
          Param: 0,
          Params: shownCardIDs,
          SpellID: 361,
          targetSeatID: 7,
          Type: 29
        }
      })
      // 实测 CGsRoleSpellOptRep 先于后续取牌 PubGsCMoveCard 到达。
      room.dispatchSkillProtocolEvent({
        type: 'choice',
        message: {
          Datas: [2, 1],
          SeatID: 3,
          SpellID: 361,
          Type: 22,
          data_count: 2
        }
      })

      const event = normalizeMoveEvent(
        moveContext({
          SpellID: 361,
          CardIDs: [0, 0, 0, 0, 0],
          CardCount: 5,
          FromID: 7,
          ToID: 3,
          FromZone: 5,
          ToZone: 5,
          MoveType: 5
        }).patched
      )

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
      room.afterMoveCommitted(event)

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
      expect(existingGroup?.expectedSlotsByLocation.get('player:7:hand:none')).toBeUndefined()
      expect(existingGroup?.expectedSlotsByLocation.get('player:3:hand:none')).toBeUndefined()
      expect(existingGroup?.expectedSlotsByLocation.get('player:6:hand:none')).toEqual({
        min: 1,
        max: 1
      })
      expect(existingGroup?.expectedSlotsByLocation.get(targetHandKey)).toBeUndefined()
      expect(existingGroup?.expectedSlotsByLocation.get(actorHandKey)).toBeUndefined()
      expect(existingGroup?.expectedSlotsByLocation.get(otherHandKey)).toEqual({ min: 1, max: 1 })

      const transferGroup = Array.from(room.constraintGroups.values()).find(
        (group) =>
          (group.sourceEvent as { type?: string } | null)?.type === 'test:xiaShu-hidden-transfer'
      )
      expect(transferGroup?.expectedSlotsByLocation.get('player:7:hand:none')).toEqual({
        min: 0,
        max: 0
      })
      expect(transferGroup?.expectedSlotsByLocation.get('player:3:hand:none')).toEqual({
        min: 5,
        max: 5
      })
      expect(transferGroup?.expectedSlotsByLocation.get(targetHandKey)).toEqual({ min: 0, max: 0 })
      expect(transferGroup?.expectedSlotsByLocation.get(actorHandKey)).toEqual({ min: 5, max: 5 })
      expect(room.readSkillState(361)).toBeUndefined()
    } finally {
      room.destroy()
    }
  })

  it.each([
    ['同区展示', { FromZone: 5, ToZone: 5, FromID: 7, ToID: 7 }],
    ['标记区来源', { FromZone: 4, ToZone: 5, FromID: 7, ToID: 3 }]
  ])('移动位置为%s时不结算下书', (_label, move) => {
    const { room } = createTestRoom({ cardIDs: [96], seatIDs: [3, 7] })
    room.registerSkillPlugin(xiaShuPlugin)
    const state = { shownCardIDs: [96], targetSeatID: 7, choice: 2, actorSeatID: 3 }
    room.setSkillState(361, state)
    room.afterMoveCommitted(
      normalizeMoveEvent(
        moveContext({
          FromPosition: POSITION_RANDOM,
          ToPosition: POSITION_TOP,
          FromZoneParam: 0,
          ToZoneParam: 0,
          ...move,
          CardIDs: [0],
          MoveType: 5,
          SpellID: 361,
          CardCount: 1
        }).patched
      )
    )

    expect(room.readSkillState(361)).toBe(state)
    room.destroy()
  })
})
