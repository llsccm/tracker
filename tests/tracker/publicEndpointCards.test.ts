import { describe, expect, it } from 'vitest'
import { POSITION_BOTTOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { isAnonymous } from '@/tracker/Card'
import { createTestRoom } from './helpers/room'

describe('getPublicEndpointCards 位置归一化', () => {
  it('数值常量与 bottom 字符串都走牌底，不误入牌顶', () => {
    const { room } = createTestRoom({
      cardIDs: [11, 12, 13, 14],
      materializeDeckIdentities: false
    })
    const pileCards = room.zones.get('pile')!.cards

    expect(pileCards).toHaveLength(4)
    expect(pileCards.every(isAnonymous)).toBe(true)

    const bottomByConstant = room.getPublicEndpointCards('pile', 2, POSITION_BOTTOM)
    const bottomByString = room.getPublicEndpointCards('pile', 2, 'bottom')
    const topByConstant = room.getPublicEndpointCards('pile', 2, POSITION_TOP)
    const topByString = room.getPublicEndpointCards('pile', 2, 'top')

    expect(bottomByString).toEqual(bottomByConstant)
    expect(bottomByConstant).toEqual(pileCards.slice(0, 2))
    expect(topByString).toEqual(topByConstant)
    expect(topByConstant).toEqual([...pileCards.slice(-2)].reverse())
    expect(bottomByString).not.toEqual(topByConstant)
  })

  it('materializeAtPublicEndpoint 对 bottom 字符串使用牌底匿名槽', () => {
    const { room } = createTestRoom({
      cardIDs: [21, 22, 23],
      materializeDeckIdentities: false
    })
    const pileCards = [...room.zones.get('pile')!.cards]
    const bottomTargets = pileCards.slice(0, 2)

    const materialized = room.materializeAtPublicEndpoint([21, 22], 'pile', 'bottom')

    expect(materialized.map((card) => card.id)).toEqual([21, 22])
    expect(materialized[0]).toBe(bottomTargets[0])
    expect(materialized[1]).toBe(bottomTargets[1])
    expect(
      room.zones
        .get('pile')!
        .cards.slice(0, 2)
        .map((card) => card.id)
    ).toEqual([21, 22])
  })

  it('materializeAtPublicEndpoint 复用正 ID 暗端点并释放原身份', () => {
    const { room } = createTestRoom({
      cardIDs: [31, 32],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const hiddenEndpoint = room.materialize(31, pile.cards.at(-1)!)!
    const displacedIdentityID = hiddenEndpoint.id
    hiddenEndpoint.reset()

    const materialized = room.materializeAtPublicEndpoint([32], 'pile', POSITION_TOP)

    expect(materialized.map((card) => card.id)).toEqual([32])
    expect(pile.cards.at(-1)).toBe(materialized[0])
    expect(materialized[0]).toBe(hiddenEndpoint)
    expect(room.cardIndex.has(displacedIdentityID)).toBe(false)
    expect(room.suspendedKnownCards.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set([31]))
  })
})
