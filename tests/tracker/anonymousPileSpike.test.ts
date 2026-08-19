import { describe, expect, it, vi } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { CARD_INSTANCE_STATUS } from '@/tracker/CardCounter'
import { HIDDEN_MARK_STATE_KEY, type HiddenMarkState } from '@/tracker/roomMovement/types'
import { getPublicFieldCandidateCards } from '@/tracker/view/publicFieldCandidates'
import { trackerLogger } from '@/utils/logger'
import { expectLocationIndexMatchesRebuild } from './helpers/locationIndex'
import { createTestRoom, getSuspendedIdentityIDs } from './helpers/room'

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

  it('公共 known 不覆盖正 ID 暗牌顶，缺失实体走诊断兜底', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4, 5],
      seatIDs: [1]
    })
    const pile = room.zones.get('pile')!
    const hiddenTopCard = pile.cards.at(-1)!
    const displacedIdentityID = hiddenTopCard.id
    const releasedSlot = room.cardIndex.get(4)!
    room.anonymizeLocatedIdentity(releasedSlot, 'test:phase5-unlocated-source', {
      preservePlacement: true
    })
    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})

    try {
      // 这是 Phase 4 后生产流程不应再产生的兼容状态：牌顶仍承载正 ID 1，但牌面未公开。
      // Phase 5 必须拒绝用协议身份 4 覆盖它；由于端点没有匿名槽，known 路径只能留下
      // 可观测诊断并补建身份 4，不能继续伪造“1 只是可替换的本地代表”。
      room.moveCards([4], 'player', {
        seatID: 1,
        fromZone: 'pile',
        cardCount: 1,
        sourceEvent: { type: 'stage1:draw-unlocated-from-positive-hidden-top' }
      })

      expect(infoSpy).toHaveBeenCalledWith(
        'known 路径实体缺口，将 createExternal',
        expect.anything()
      )
    } finally {
      infoSpy.mockRestore()
    }

    const fallbackCard = room.cardIndex.get(4)
    expect(fallbackCard).toBeTruthy()
    expect(fallbackCard).not.toBe(hiddenTopCard)
    expect(fallbackCard?.location).toBe('player')
    expect(fallbackCard?.isKnown).toBe(true)
    expect(pile.cards).toHaveLength(5)
    expect(pile.cards.at(-1)).toBe(hiddenTopCard)
    expect(hiddenTopCard.id).toBe(displacedIdentityID)
    expect(hiddenTopCard.isKnown).toBe(false)
    expect(room.cardIndex.get(displacedIdentityID)).toBe(hiddenTopCard)
    expect(room.suspendedKnownCards.size).toBe(0)
    expect(room.unlocatedIdentities).toEqual(new Set())
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

  it('洗牌为未决身份创建 suspended 展示实体并保留玩家匿名槽位', () => {
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

    expect(getSuspendedIdentityIDs(room)).toEqual([4, 5, 6])
    expect(Array.from(room.cardIndex.keys()).sort((left, right) => left - right)).toEqual([4, 5, 6])
    expect(
      getPublicFieldCandidateCards(room)
        .map((card) => card.id)
        .sort((left, right) => left - right)
    ).toEqual([4, 5, 6])
    room.suspendedKnownCards.forEach((card) => {
      expect(card.location).toBe('suspended')
      expect(card.isKnown).toBe(true)
      expect(card.suspended).toBe(true)
      expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.APPEARED]).toContain(card)
    })
    expectLocationIndexMatchesRebuild(room)
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3]))
    expect(discard.cards).toEqual([])
    expect(pile.cards).toHaveLength(4)
    expect(pile.cards).toContain(remainingPileSlot)
    expect(pile.cards.every(isAnonymous)).toBe(true)
    expect(playerSlots.map((card) => card.entityID)).toEqual(playerSlotEntityIDs)
    playerSlots.forEach((card) => {
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.isKnown).toBe(false)
    })
    expect(room.getPlayer(1).unknownCardCount).toBe(2)
  })

  it('洗牌后连续明摸只物化匿名牌堆槽', () => {
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
    expect(pile.cards.every(isAnonymous)).toBe(true)
    expect(getSuspendedIdentityIDs(room)).toEqual([4, 5, 6])

    room.moveCards([4], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-suspended-from-anonymous-top' }
    })
    expect(pile.cards).toHaveLength(3)
    expect(room.cardIndex.get(4)).toMatchObject({ location: 'player', isKnown: true })
    expect(getSuspendedIdentityIDs(room)).toEqual([5, 6])

    room.moveCards([5], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-suspended-from-positive-hidden-top' }
    })

    expect(pile.cards).toHaveLength(2)
    expect(room.cardIndex.get(5)).toMatchObject({ location: 'player', isKnown: true })
    expect(getSuspendedIdentityIDs(room)).toEqual([6])
    expect(room.unlocatedIdentities).toEqual(new Set([1, 2, 3]))
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

  it('连续洗牌沿用历史 suspended 并暂停下一世代尚未出现的身份', () => {
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

    const hiddenPileCard = pile.cards.at(-1)!
    const hiddenPileEntityID = hiddenPileCard.entityID
    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      sourceCards: [hiddenPileCard],
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-positive-hidden-before-second-shuffle' }
    })

    room.moveCards([4], 'discard', {
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'stage1:discard-before-second-shuffle-summary' }
    })

    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})
    try {
      room.shufflePile({ cardCount: pile.cards.length + discard.cards.length })

      expect(getSuspendedIdentityIDs(room)).toEqual([1, 2, 3, 5, 6])
      expect(infoSpy).toHaveBeenCalledWith(
        '洗牌后暂停追踪旧牌堆世代中尚未出现的身份',
        expect.objectContaining({ suspendedCardIDs: [1, 2, 3] })
      )
    } finally {
      infoSpy.mockRestore()
    }

    expect(hiddenPileCard.entityID).toBe(hiddenPileEntityID)
    expect(hiddenPileCard.location).toBe('player')
    expect(hiddenPileCard).toSatisfy(isAnonymous)
    expect(pile.cards.every(isAnonymous)).toBe(true)
    expect(room.cardIndex.has(4)).toBe(false)
    expect(room.unlocatedIdentities).toEqual(new Set([4]))
  })

  it('玩家匿名槽揭示后再次洗牌仍保持身份全集', () => {
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

    const hiddenPileCard = pile.cards.at(-1)!
    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      sourceCards: [hiddenPileCard],
      cardCount: 1,
      sourceEvent: { type: 'stage1:draw-positive-hidden-player-placeholder' }
    })
    room.moveCards([4], 'discard', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'stage1:reveal-suspended-from-positive-hidden-placeholder' }
    })

    const revealedIdentity = room.cardIndex.get(4)!
    expect(revealedIdentity).not.toBe(hiddenPileCard)
    expect(revealedIdentity.location).toBe('discard')
    expect(revealedIdentity.isKnown).toBe(true)
    expect(hiddenPileCard).toSatisfy(isAnonymous)
    expect(hiddenPileCard.location).toBe('outside')

    room.shufflePile({ cardCount: pile.cards.length + discard.cards.length })

    expect(revealedIdentity).toSatisfy(isAnonymous)
    expect(revealedIdentity.location).toBe('pile')
    expect(getSuspendedIdentityIDs(room)).toEqual([1, 2, 3])
    expect(room.cardIndex.size).toBe(3)
    expect(room.unlocatedIdentities).toEqual(new Set([4]))
    expect(room.deckIdentities.size).toBe(4)
  })

  it('洗牌时将 cohort 暗标记实体原地匿名化', () => {
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
    const recordBefore = room
      .readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
      .records.get('1:1:700')!
    expect(recordBefore.placeholderCards.has(hiddenMarkCard)).toBe(true)
    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})

    try {
      room.shufflePile({ cardCount: 3 })

      const recordAfter = room
        .readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
        .records.get('1:1:700')!
      expect(recordAfter.placeholderCards.has(hiddenMarkCard)).toBe(true)
      expect(hiddenMarkCard).toSatisfy(isAnonymous)
      expect(hiddenMarkCard.location).toBe('player')
      expect(hiddenMarkCard.subZone).toBe('mark')
      expect(hiddenMarkCard.spellID).toBe(700)
      expect(hiddenMarkCard.seats.has(1)).toBe(true)
      expect(hiddenMarkCard.suspended).toBe(false)
      expect(hiddenMarkCard.isKnown).toBe(false)
      expect(room.counter.cardsByStatus[CARD_INSTANCE_STATUS.APPEARED]).toContain(hiddenMarkCard)
      const suspendedIdentity = room.cardIndex.get(5)!
      expect(suspendedIdentity).not.toBe(hiddenMarkCard)
      expect(suspendedIdentity).toMatchObject({
        location: 'suspended',
        isKnown: true,
        suspended: true
      })
      expect(room.unlocatedIdentities.has(5)).toBe(false)
      expect(getSuspendedIdentityIDs(room)).toEqual([2, 3, 5])
      expect(getPublicFieldCandidateCards(room)).not.toContain(hiddenMarkCard)
      expect(getPublicFieldCandidateCards(room)).toContain(suspendedIdentity)
      expect(discard.cards).toEqual([])
      expect(infoSpy).toHaveBeenCalledWith(
        '洗牌后暂停追踪旧牌堆世代中尚未出现的身份',
        expect.objectContaining({ suspendedCardIDs: [2, 3, 5] })
      )
    } finally {
      infoSpy.mockRestore()
    }
  })
})
