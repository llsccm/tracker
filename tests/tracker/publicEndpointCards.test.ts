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

  it('materializeAtPublicEndpoint 不覆盖其它正 ID 暗端点', () => {
    const { room } = createTestRoom({
      cardIDs: [31, 32]
    })
    const pile = room.zones.get('pile')!
    const hiddenEndpoint = pile.cards.at(-1)!
    room.anonymizeLocatedIdentity(room.cardIndex.get(31)!, 'test:phase5-unlocated-endpoint', {
      preservePlacement: true
    })

    const materialized = room.materializeAtPublicEndpoint([31], 'pile', POSITION_TOP)

    expect(materialized).toEqual([])
    expect(pile.cards.at(-1)).toBe(hiddenEndpoint)
    expect(hiddenEndpoint.id).toBe(32)
    expect(hiddenEndpoint.isKnown).toBe(false)
    expect(room.cardIndex.get(32)).toBe(hiddenEndpoint)
    expect(room.suspendedKnownCards.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set([31]))
  })

  it('materializeAtPublicEndpoint 直接确认端点中的同 ID 实体', () => {
    const { room } = createTestRoom({
      cardIDs: [31, 32]
    })
    const pile = room.zones.get('pile')!
    const hiddenEndpoint = pile.cards.at(-1)!

    const materialized = room.materializeAtPublicEndpoint([32], 'pile', POSITION_TOP)

    expect(materialized).toEqual([hiddenEndpoint])
    expect(pile.cards.at(-1)).toBe(hiddenEndpoint)
    expect(hiddenEndpoint.id).toBe(32)
    expect(hiddenEndpoint.isKnown).toBe(true)
    expect(room.cardIndex.get(32)).toBe(hiddenEndpoint)
    expect(room.unlocatedIdentities).toEqual(new Set())
  })

  it('materializeAtPublicEndpoint 用匿名槽恢复 suspended 身份且不转移暂停角色', () => {
    const { room } = createTestRoom({
      cardIDs: [41, 42, 43]
    })
    const pile = room.zones.get('pile')!
    const suspendedIdentity = room.cardIndex.get(41)!
    pile.removeCard(suspendedIdentity)
    room.constraints.suspendKnownCard(suspendedIdentity, 'test:phase5-public-reveal')
    const anonymousTarget = room.cardIndex.get(43)!
    room.anonymizeLocatedIdentity(anonymousTarget, 'test:phase5-suspended-target', {
      preservePlacement: true
    })
    const targetIndex = pile.cards.indexOf(anonymousTarget)

    // suspended 是身份状态，不是匿名物理槽的名额。身份重新出现时应接管匿名端点并直接
    // 恢复追踪，匿名槽退出公共区即可，不能再被转成新的 suspended 正 ID 实体。
    const materialized = room.materializeAtPublicEndpoint([41], 'pile', POSITION_TOP)

    expect(materialized).toEqual([suspendedIdentity])
    expect(pile.cards[targetIndex]).toBe(suspendedIdentity)
    expect(suspendedIdentity.location).toBe('pile')
    expect(suspendedIdentity.isKnown).toBe(true)
    expect(suspendedIdentity.suspended).toBe(false)
    expect(room.suspendedKnownCards.has(suspendedIdentity)).toBe(false)
    expect(anonymousTarget).toSatisfy(isAnonymous)
    expect(anonymousTarget.location).toBe('outside')
    expect(anonymousTarget.suspended).toBe(false)
  })
})
