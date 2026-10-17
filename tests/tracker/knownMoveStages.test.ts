import { describe, expect, it } from 'vitest'
import { createTestRoom } from './helpers/room'

describe('已知牌来源与落区阶段顺序', () => {
  it.each(['outside', 'pile', 'player'] as const)(
    '%s 来源先按协议顺序解析并确认整批身份，再逐牌执行技能与落区',
    (source) => {
      const { room } = createTestRoom({
        cardIDs: source === 'outside' ? [60] : [50, 51, 60],
        seatIDs: [1],
        materializeDeckIdentities: false
      })
      if (source === 'player') {
        room.moveCards([0, 0], 'player', {
          fromZone: 'pile',
          toSeatID: 1,
          subZone: 'hand',
          cardCount: 2
        })
      }

      const cardIDs = [51, 50]
      const calls: { cardID: number; confirmed: boolean[] }[] = []
      room.registerSkillHandler(9000, (card) => {
        calls.push({
          cardID: card.id,
          confirmed: cardIDs.map((cardID) => room.cardIndex.get(cardID)?.isKnown === true)
        })
      })

      room.moveCards(cardIDs, 'discard', {
        fromZone: source === 'player' ? null : source,
        fromSeatID: source === 'player' ? 1 : undefined,
        fromSubZone: 'hand',
        cardCount: 2,
        spellID: 9000
      })

      expect(calls).toEqual([
        { cardID: 51, confirmed: [true, true] },
        { cardID: 50, confirmed: [true, true] }
      ])
      expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual(cardIDs)
      expect(room.playerCardsSnapshot).toHaveLength(0)
    }
  )

  it('玩家目标保持逐牌的来源处理、技能回调与绑定顺序，不整批提前落区', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    room.moveCards([1, 2], 'player', {
      fromZone: 'pile',
      toSeatID: 1,
      subZone: 'hand',
      cardCount: 2
    })
    const calls: { cardID: number; seats: (number | null)[] }[] = []
    room.registerSkillHandler(9000, (card) => {
      calls.push({
        cardID: card.id,
        seats: [1, 2].map((cardID) => room.cardIndex.get(cardID)!.resolvedSeat)
      })
    })

    room.moveCards([1, 2], 'player', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      toSeatID: 2,
      subZone: 'hand',
      cardCount: 2,
      spellID: 9000
    })

    expect(calls).toEqual([
      { cardID: 1, seats: [1, 1] },
      { cardID: 2, seats: [2, 1] }
    ])
    expect(room.getPlayerHandCardIDs(2)).toEqual([1, 2])
    expect(room.getPlayerHandCardIDs(1)).toEqual([])
  })
})
