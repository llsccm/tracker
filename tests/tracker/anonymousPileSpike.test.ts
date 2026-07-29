import { describe, expect, it, vi } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { CARD_INSTANCE_STATUS } from '@/tracker/CardCounter'
import { getPublicFieldCandidateCards } from '@/tracker/view/publicFieldCandidates'
import { trackerLogger } from '@/utils/logger'
import { expectLocationIndexMatchesRebuild } from './helpers/locationIndex'
import { createTestRoom } from './helpers/room'

describe('阶段 1 匿名牌堆 spike', () => {
  it('牌堆初始化为匿名槽并把整副牌登记为未定位身份', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!

    expect(pile.cards).toHaveLength(3)
    expect(pile.cards.every(isAnonymous)).toBe(true)
    expect(new Set(pile.cards.map((card) => card.entityID)).size).toBe(3)
    expect(room.cardIndex.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3]))
    expect(room.counter.statusIndex[CARD_INSTANCE_STATUS.UNKNOWN]).toEqual(new Set([1, 2, 3]))
  })

  it('未知摸牌只移动匿名槽且不提前认领真实身份', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })

    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'stage1:draw-unknown' }
    })

    const hiddenHand = room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand'
    )
    expect(hiddenHand).toHaveLength(2)
    expect(hiddenHand.every(isAnonymous)).toBe(true)
    expect(room.zones.get('pile')!.cards).toHaveLength(2)
    expect(room.cardIndex.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3, 4]))
  })

  it('牌堆来源明牌原地物化且不触发旧冲突修复路径', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const originalTopSlot = pile.cards.at(-1)

    room.moveCards([4], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-known' }
    })

    const card = room.cardIndex.get(4)
    expect(card).toBe(originalTopSlot)
    expect(card?.entityID).toBe(4)
    expect(card?.location).toBe('player')
    expect(card?.isKnown).toBe(true)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3]))
    expect(pile.cards).toHaveLength(3)
  })

  it('未定位身份命中正 ID 暗牌顶时复用槽位并释放被挤身份', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const hiddenTopCard = room.materialize(1, pile.cards.at(-1)!)!
    const displacedIdentityID = hiddenTopCard.id
    hiddenTopCard.reset()
    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})

    try {
      // 4 尚未建立实体，而牌顶已经是洗牌后隐藏的正 ID 1。明摸 4 应消费这个
      // 物理牌堆槽，并把仅由本地随机牌序绑定的身份 1 退回未定位池。
      room.moveCards([4], 'player', {
        seatID: 1,
        fromZone: 'pile',
        cardCount: 1,
        sourceEvent: { type: 'stage1:draw-unlocated-from-positive-hidden-top' }
      })

      expect(infoSpy).not.toHaveBeenCalledWith(
        'known 路径实体缺口，将 createExternal',
        expect.anything()
      )
    } finally {
      infoSpy.mockRestore()
    }

    const materializedCard = room.cardIndex.get(4)
    expect(materializedCard).toBeTruthy()
    expect(materializedCard).toBe(hiddenTopCard)
    expect(materializedCard?.location).toBe('player')
    expect(materializedCard?.isKnown).toBe(true)
    expect(pile.cards).toHaveLength(3)
    expect(room.cardIndex.has(displacedIdentityID)).toBe(false)
    expect(room.suspendedKnownCards.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3]))
  })

  it('游戏外匿名手牌首次揭示时扩展并物化身份全集', () => {
    const { room } = createTestRoom({
      cardIDs: [1],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const [placeholder] = room.createExternalCards([], 1)
    placeholder.bindCandidates([1], 'hand', null, { known: false })

    room.moveCards([60992], 'player', {
      seatID: 1,
      fromSeatID: 1,
      fromZone: null,
      fromSubZone: 'hand',
      subZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'stage1:reveal-external-hand' }
    })

    expect(room.cardIndex.get(60992)).toBe(placeholder)
    expect(placeholder.id).toBe(60992)
    expect(placeholder.isKnown).toBe(true)
    expect(room.deckIdentities.has(60992)).toBe(true)
    expect(room.unlocatedIdentities.has(60992)).toBe(false)
  })

  it('公共区来源无匿名槽可物化时补建缺失正 ID', () => {
    const { room } = createTestRoom({
      cardIDs: [1],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    pile.clear()

    room.moveCards([77], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'stage1:public-missing-fallback' }
    })

    const card = room.cardIndex.get(77)
    expect(card).toBeTruthy()
    expect(card?.location).toBe('player')
    expect(card?.subZone).toBe('hand')
    expect(card?.isKnown).toBe(true)
    expect(room.deckIdentities.has(77)).toBe(true)
    expect(room.unlocatedIdentities.has(77)).toBe(false)
  })

  it('匿名牌堆洗牌时恢复未定位身份的暂停追踪并保留玩家槽位', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4, 5, 6],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const discard = room.zones.get('discard')!

    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'stage1:draw-unknown-before-shuffle' }
    })
    room.getPlayer(1).syncObservedHandCount(2)
    room.moveCards([1, 2, 3], 'discard', {
      fromZone: 'pile',
      cardCount: 3,
      sourceEvent: { type: 'stage1:discard-before-shuffle' }
    })

    const playerSlots = room.cards.filter((card) => isAnonymous(card) && card.location === 'player')
    const remainingPileSlot = pile.cards[0]
    const playerSlotEntityIDs = playerSlots.map((card) => card.entityID)

    expect(playerSlots).toHaveLength(2)
    expect(pile.cards).toEqual([remainingPileSlot])
    expect(discard.cards).toHaveLength(3)
    expect(room.unlocatedIdentities).toEqual(new Set([4, 5, 6]))

    room.shufflePile({ cardCount: 4 })

    const suspendedIdentities = Array.from(room.suspendedKnownCards).sort(
      (left, right) => left.id - right.id
    )
    expect(suspendedIdentities.map((card) => card.id)).toEqual([4, 5, 6])
    suspendedIdentities.forEach((card) => {
      expect(card.location).toBe('suspended')
      expect(card.suspended).toBe(true)
      expect(card.isKnown).toBe(true)
      expect(room.counter.cardInstances[card.id].status).toBe(CARD_INSTANCE_STATUS.APPEARED)
    })
    expect(getPublicFieldCandidateCards(room)).toEqual(expect.arrayContaining(suspendedIdentities))
    expect(room.unlocatedIdentities).toEqual(new Set())
    expect(discard.cards).toEqual([])
    expect(pile.cards).toHaveLength(4)
    expect(pile.cards).toContain(remainingPileSlot)
    expect(remainingPileSlot).toSatisfy(isAnonymous)
    expect(playerSlots.map((card) => card.entityID)).toEqual(playerSlotEntityIDs)
    playerSlots.forEach((card) => {
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.isKnown).toBe(false)
    })
    expect(room.getPlayer(1).unknownCardCount).toBe(2)
  })

  it('洗牌后明摸暂停身份遇到正 ID 暗牌顶时仍消耗牌堆槽', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4, 5, 6],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!

    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'stage1:draw-unknown-before-shuffle' }
    })
    room.moveCards([1, 2, 3], 'discard', {
      fromZone: 'pile',
      cardCount: 3,
      sourceEvent: { type: 'stage1:discard-before-shuffle' }
    })
    room.shufflePile({ cardCount: 4 })

    room.moveCards([4], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-suspended-from-anonymous-top' }
    })
    expect(pile.cards).toHaveLength(3)

    const suspendedCountBeforePositiveHiddenDraw = room.suspendedKnownCards.size
    const displacedPileIdentityID = pile.cards.at(-1)!.id
    expect(displacedPileIdentityID).toBeGreaterThan(0)

    room.moveCards([5], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-suspended-from-positive-hidden-top' }
    })

    expect(pile.cards).toHaveLength(2)
    expect(room.counter.statusIndex[CARD_INSTANCE_STATUS.UNKNOWN].size).toBe(2)
    // 5 原本占用一个场外 suspended 名额。它从正 ID 暗牌顶出现后，该名额应转交给
    // 被挤出的牌堆身份，而不是像普通 unlocated 物化一样只释放到未定位池。
    expect(room.suspendedKnownCards.size).toBe(suspendedCountBeforePositiveHiddenDraw)
    expect(room.suspendedKnownCards.has(room.cardIndex.get(displacedPileIdentityID)!)).toBe(true)
    expect(room.suspendedKnownCards.has(room.cardIndex.get(5)!)).toBe(false)
  })

  it('洗牌新建的暂停身份逆序进入手牌并二次洗牌时保持增量索引顺序', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4, 5, 6],
      seatIDs: [1],
      materializeDeckIdentities: false
    })

    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'stage1:draw-unknown-before-shuffle' }
    })
    room.moveCards([1, 2, 3], 'discard', {
      fromZone: 'pile',
      cardCount: 3,
      sourceEvent: { type: 'stage1:discard-before-shuffle' }
    })
    room.shufflePile({ cardCount: 4 })
    ;[6, 5].forEach((cardID) => {
      room.moveCards([cardID], 'player', {
        seatID: 1,
        fromZone: 'pile',
        cardCount: 1,
        sourceEvent: { type: 'stage1:draw-suspended-out-of-creation-order' }
      })
    })
    room.moveCards([6], 'discard', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'stage1:discard-before-second-shuffle' }
    })
    room.shufflePile({ cardCount: 3 })

    expectLocationIndexMatchesRebuild(room)
  })

  it('二次洗牌日志合并沿用与本轮新增的暂停身份', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4, 5, 6],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const discard = room.zones.get('discard')!

    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'stage1:draw-unknown-before-first-shuffle' }
    })
    room.moveCards([1, 2, 3], 'discard', {
      fromZone: 'pile',
      cardCount: 3,
      sourceEvent: { type: 'stage1:discard-before-first-shuffle' }
    })
    room.shufflePile({ cardCount: 4 })

    const carriedSuspendedCardIDs = Array.from(room.suspendedKnownCards, (card) => card.id)
    const hiddenPileCard = pile.cards.find((card) => card.id > 0 && card.isKnown !== true)!
    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      sourceCards: [hiddenPileCard],
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-positive-hidden-before-second-shuffle' }
    })

    const recycledCard = pile.cards.find((card) => card.id > 0 && card.isKnown !== true)!
    room.moveCards([recycledCard.id], 'discard', {
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'stage1:discard-before-second-shuffle-summary' }
    })

    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})
    try {
      room.shufflePile({ cardCount: pile.cards.length + discard.cards.length })

      const activeSuspendedCardIDs = Array.from(room.suspendedKnownCards, (card) => card.id)
      expect(activeSuspendedCardIDs).toEqual([...carriedSuspendedCardIDs, hiddenPileCard.id])
      expect(infoSpy).toHaveBeenCalledWith(
        '洗牌后暂停追踪非实际牌堆内正 ID 暗身份',
        expect.objectContaining({
          suspendedCardIDs: activeSuspendedCardIDs,
          carriedSuspendedCardIDs,
          newlySuspendedCardIDs: [hiddenPileCard.id],
          visibleKnownCardIDs: expect.not.arrayContaining(carriedSuspendedCardIDs),
          preservedPlayerPlaceholders: expect.arrayContaining([
            expect.objectContaining({ sourceCardID: hiddenPileCard.id })
          ])
        })
      )
    } finally {
      infoSpy.mockRestore()
    }
  })

  it('玩家来源揭示暂停身份时保留被替换的正 ID 暗身份', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const discard = room.zones.get('discard')!

    room.moveCards([1, 2, 3], 'discard', {
      fromZone: 'pile',
      cardCount: 3,
      sourceEvent: { type: 'stage1:discard-before-hidden-identity-shuffle' }
    })
    room.shufflePile({ cardCount: 4 })

    const suspendedCard = room.cardIndex.get(4)!
    const hiddenPileCard = pile.cards.find((card) => card.id > 0 && card.isKnown !== true)!
    const hiddenIdentityID = hiddenPileCard.id
    expect(suspendedCard.suspended).toBe(true)

    // 暗摸把一个 reset() 后的正 ID 牌堆槽带入手牌；随后协议从同一手牌明示暂停身份 4。
    // 置换后该正 ID 暗槽不再承担手牌数量，但它的身份仍必须留在完整牌组中。
    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      sourceCards: [hiddenPileCard],
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-positive-hidden-player-placeholder' }
    })
    room.moveCards([suspendedCard.id], 'discard', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'stage1:reveal-suspended-from-positive-hidden-placeholder' }
    })

    expect(room.cardIndex.has(hiddenIdentityID)).toBe(false)
    expect(room.unlocatedIdentities.has(hiddenIdentityID)).toBe(true)

    room.shufflePile({ cardCount: pile.cards.length + discard.cards.length })

    expect(Array.from(room.suspendedKnownCards, (card) => card.id)).toContain(hiddenIdentityID)
    const remainingIdentityIDs = new Set([
      ...pile.cards.map((card) => card.id).filter((cardID) => cardID > 0),
      ...Array.from(room.suspendedKnownCards, (card) => card.id)
    ])
    expect(remainingIdentityIDs).toEqual(room.deckIdentities)
    expect(room.deckIdentities.size).toBe(4)
  })

  it('匿名牌堆洗牌时将 APPEARED 暗身份归入独立诊断分类', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4, 5],
      seatIDs: [1]
    })
    const pile = room.zones.get('pile')!
    const discard = room.zones.get('discard')!
    const hiddenMarkCard = room.cardIndex.get(5)!
    const visibleHandCard = room.cardIndex.get(4)!

    room.moveCards([1], 'discard', {
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'stage1:discard-before-appeared-shuffle' }
    })
    pile.removeCard(visibleHandCard)
    pile.removeCard(hiddenMarkCard)
    visibleHandCard.bindCandidates([1], 'hand', null, { known: true })
    hiddenMarkCard.bindCandidates([1], 'hand', null, { known: false })
    room.getPlayer(1).syncObservedHandCount(2)
    room.moveCards([0], 'player', {
      seatID: 1,
      fromSeatID: 1,
      fromZone: 5,
      fromSubZone: 'hand',
      subZone: 'mark',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'stage1:appeared-hidden-before-shuffle' }
    })

    expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.APPEARED]).toContain(hiddenMarkCard)
    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})

    try {
      room.shufflePile({ cardCount: 3 })

      expect(hiddenMarkCard.location).toBe('suspended')
      expect(hiddenMarkCard.suspended).toBe(true)
      expect(hiddenMarkCard.isKnown).toBe(true)
      expect(getPublicFieldCandidateCards(room)).toContain(hiddenMarkCard)
      expect(discard.cards).toEqual([])
      expect(infoSpy).toHaveBeenCalledWith(
        '洗牌后暂停追踪非实际牌堆内正 ID 暗身份',
        expect.objectContaining({
          neverAppearedCardIDs: [],
          appearedHiddenIdentityCardIDs: [5],
          suspendedCardIDs: [5]
        })
      )
    } finally {
      infoSpy.mockRestore()
    }
  })
})
