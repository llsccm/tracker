import { describe, expect, it, vi } from 'vitest'
import { POSITION_BOTTOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type { Card } from '@/tracker/Card'
import type { Room } from '@/tracker/Room'
import { getPileDisplayCards } from '@/tracker/helper/pileOrder'
import { getPublicFieldCandidateCards } from '@/tracker/view/publicFieldCandidates'
import { trackerLogger } from '@/utils/logger'
import { createTestRoom } from './helpers/room'

function getPile(room: Room) {
  return room.zones.get('pile')!
}

function getDiscard(room: Room) {
  return room.zones.get('discard')!
}

function getCards(room: Room, ids: number[]) {
  return ids.map((id) => room.cardIndex.get(id)!)
}

function recycleIdsToDiscard(room: Room, ids: number[]) {
  const pile = getPile(room)
  const discard = getDiscard(room)
  const cards = getCards(room, ids)
  cards.forEach((card) => {
    pile.removeCard(card)
    discard.add(card)
  })
  return cards
}

function removeIdsFromPile(room: Room, ids: number[]) {
  const pile = getPile(room)
  return getCards(room, ids).map((card) => {
    pile.removeCard(card)
    return card
  })
}

function bindHiddenHands(room: Room, ids: number[], seatID: number, known = false) {
  return removeIdsFromPile(room, ids).map((card) => {
    card.bindCandidates([seatID], 'hand', null, { known })
    return card
  })
}

function shuffleWithFixedRandom(room: Room, options?: Parameters<Room['shufflePile']>[0]) {
  const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
  try {
    room.shufflePile(options)
  } finally {
    randomSpy.mockRestore()
  }
}

function withWarnSpy(run: (warnSpy: ReturnType<typeof vi.spyOn>) => void) {
  const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})
  try {
    run(warnSpy)
  } finally {
    warnSpy.mockRestore()
  }
}

function expectConsistentPublicZones(room: Room) {
  expect(room.publicZones.getPublicZoneConsistencyIssues()).toEqual([])
}

function playerHandPlaceholders(room: Room, seatID?: number) {
  return room.cards.filter(
    (card) =>
      card.id === 0 &&
      card.location === 'player' &&
      card.subZone === 'hand' &&
      (seatID === undefined || card.seats.has(seatID))
  )
}

describe('牌堆展示顺序', () => {
  it('初始化牌堆时批量写入有序关系且独立于房间卡牌池数组', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 127] })
    const pileCards = getPile(room).cards

    expect(pileCards.map((card) => card.id)).toEqual([1, 2, 127])
    expect(pileCards).not.toBe(room.cards)
  })

  it('底部回收的牌在展示顺序末端', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 127] })

    room.moveCards([127], 'discard', {
      fromZone: 'pile',
      fromPosition: POSITION_TOP,
      position: POSITION_TOP,
      cardCount: 1,
      sourceEvent: { type: 'test:discard-top' }
    })
    room.moveCards([127], 'pile', {
      fromZone: 'discard',
      fromPosition: POSITION_TOP,
      position: POSITION_BOTTOM,
      cardCount: 1,
      sourceEvent: { type: 'test:return-to-bottom' }
    })

    const internalPileCards = room.locationIndex.publicByZone.get('pile') ?? []

    expect(internalPileCards.map((card) => card.id)).toEqual([127, 1, 2])
    expect(getPileDisplayCards(internalPileCards).map((card) => card.id)).toEqual([2, 1, 127])
  })

  it('批量替换牌堆时从其它公共区移除同一张牌', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 127] })
    const pile = getPile(room)
    const discard = getDiscard(room)
    const [topCard] = pile.remove(1, POSITION_TOP)

    discard.add(topCard)
    pile.replaceAll([topCard])

    expect(discard.cards).not.toContain(topCard)
    expect(pile.cards).toEqual([topCard])
    expect(topCard.location).toBe('pile')
    expectConsistentPublicZones(room)
  })

  it.each([
    {
      name: '洗回弃牌时保留剩余牌堆顶部顺序',
      cardIDs: [1, 2, 3, 4, 5],
      recycleIds: [2],
      shuffleOptions: undefined as Parameters<Room['shufflePile']>[0],
      confirmRemainingKnown: false,
      assert(room: Room, displayBefore: number[]) {
        const pile = getPile(room)
        expect(pile.cards.map((card) => card.id)).toEqual([2, 1, 3, 4, 5])
        expect(
          getPileDisplayCards(pile.cards)
            .slice(0, displayBefore.length)
            .map((card) => card.id)
        ).toEqual(displayBefore)
        expect(getDiscard(room).cards).toEqual([])
        expect(room.suspendedKnownCards.size).toBe(0)
      }
    },
    {
      name: '协议牌堆数量精确匹配时只洗回弃牌并保留剩余牌堆顺序',
      cardIDs: [1, 2, 3, 4, 5],
      recycleIds: [1, 2],
      shuffleOptions: { cardCount: 5 } as Parameters<Room['shufflePile']>[0],
      confirmRemainingKnown: false,
      assert(room: Room) {
        const pile = getPile(room)
        expect(pile.cards.map((card) => card.id)).toEqual([1, 2, 3, 4, 5])
        expect(pile.cards).toHaveLength(5)
        expect(pile.cards.every((card) => card.id > 0)).toBe(true)
        expect(getDiscard(room).cards).toEqual([])
        expect(room.suspendedKnownCards.size).toBe(0)
      }
    },
    {
      name: '牌堆剩余 3 张明牌时洗回弃牌后顶部仍是这 3 张',
      cardIDs: [1, 2, 3, 4, 5, 6],
      recycleIds: [1, 2, 3],
      shuffleOptions: { cardCount: 3 } as Parameters<Room['shufflePile']>[0],
      confirmRemainingKnown: true,
      assert(room: Room, displayBefore: number[]) {
        const visibleTopAfter = getPileDisplayCards(getPile(room).cards).slice(0, 3)
        expect(visibleTopAfter.map((card) => card.id)).toEqual(displayBefore)
        expect(visibleTopAfter.every((card) => card.isKnown)).toBe(true)
        expect(getDiscard(room).cards).toEqual([])
      }
    }
  ])('$name', ({ cardIDs, recycleIds, shuffleOptions, confirmRemainingKnown, assert }) => {
    const { room } = createTestRoom({ cardIDs })
    const pile = getPile(room)
    recycleIdsToDiscard(room, recycleIds)
    if (confirmRemainingKnown) {
      pile.cards.forEach((card) => card.confirmKnown())
    }
    const displayBefore = getPileDisplayCards(pile.cards)
      .slice(0, confirmRemainingKnown ? 3 : pile.cards.length)
      .map((card) => card.id)

    shuffleWithFixedRandom(room, shuffleOptions)
    assert(room, displayBefore)
    expectConsistentPublicZones(room)
  })

  it('显式 null 牌堆数量按未提供协议数量处理', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
    recycleIdsToDiscard(room, [1])

    withWarnSpy((warnSpy) => {
      room.shufflePile({ cardCount: null })
      expect(warnSpy).not.toHaveBeenCalled()
      expect(getPile(room).cards).toHaveLength(3)
      expect(getDiscard(room).cards).toEqual([])
      expectConsistentPublicZones(room)
    })
  })

  it.each([
    {
      name: '协议牌堆数量偏小时暂停从未出现的暗手牌身份并保留玩家占位',
      cardCount: 3,
      expectWarnAboutZeroPlaceholder: false
    },
    {
      name: '协议牌堆空间数量偏大时用从未出现正 ID 解释缺口但不补入实际牌堆',
      cardCount: 5,
      expectWarnAboutZeroPlaceholder: false
    }
  ])('$name', ({ cardCount, expectWarnAboutZeroPlaceholder }) => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1] })
    const hiddenHandCards = bindHiddenHands(room, [4, 5], 1, false)
    room.getPlayer(1).syncObservedHandCount(2)

    withWarnSpy((warnSpy) => {
      room.shufflePile({ cardCount })

      if (expectWarnAboutZeroPlaceholder) {
        expect(warnSpy).toHaveBeenCalled()
      } else {
        expect(warnSpy).not.toHaveBeenCalled()
      }

      expect(getPile(room).cards.map((card) => card.id)).toEqual([1, 2, 3])
      expect(getPile(room).cards.filter((card) => card.id === 0)).toHaveLength(0)
      hiddenHandCards.forEach((card) => {
        expect(card.location).toBe('suspended')
        expect(card.subZone).toBeNull()
        expect(card.suspended).toBe(true)
        expect(card.isKnown).toBe(true)
        expect(room.counter.cardInstances[card.id].status).toBe(1)
      })
      if (cardCount === 3) {
        hiddenHandCards.forEach((card) => {
          expect(getPublicFieldCandidateCards(room)).toContain(card)
        })
      }
      const placeholders = playerHandPlaceholders(room, 1)
      expect(placeholders).toHaveLength(2)
      placeholders.forEach((card) => {
        expect(card.seats.has(1)).toBe(true)
        expect(card.isKnown).toBe(false)
      })
      expect(room.getPlayer(1).unknownCardCount).toBe(2)
      expectConsistentPublicZones(room)
    })
  })

  it('协议牌堆空间数量偏大但无正 ID 可解释时只提示不补 id=0', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3] })
    const pile = getPile(room)

    withWarnSpy((warnSpy) => {
      room.shufflePile({ cardCount: 5 })

      expect(pile.cards).toHaveLength(3)
      expect(pile.cards.map((card) => card.id)).toEqual([1, 2, 3])
      expect(pile.cards.filter((card) => card.id === 0)).toHaveLength(0)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('未创建 id=0 牌堆占位'),
        expect.objectContaining({
          cardCount: 5,
          knownPileCount: 3,
          pileSpaceRemainingCount: 3,
          rebuiltPileCount: 3
        })
      )
      expectConsistentPublicZones(room)
    })
  })

  it('暂停正 ID 原座位不匹配时按实体位置补位并发出校验警告', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 113, 137], seatIDs: [0, 4] })
    const pile = getPile(room)
    const knownHandCard = room.cardIndex.get(113)!
    const suspendedHandIdentity = room.cardIndex.get(137)!

    pile.removeCard(knownHandCard)
    pile.removeCard(suspendedHandIdentity)
    knownHandCard.bindCandidates([4], 'hand', null, { known: true })
    // 模拟真实复现日志：洗牌时 137 的本地暗槽位错误地记录在 seat 0，
    // 但 4 号的观测手牌数为 2，除明牌 113 外还需要 1 个暗手牌槽位。
    suspendedHandIdentity.bindCandidates([0], 'hand', null, { known: false })
    room.getPlayer(4).syncObservedHandCount(2)

    withWarnSpy((shuffleWarnSpy) => {
      room.shufflePile({ cardCount: 3 })
      expect(shuffleWarnSpy).toHaveBeenCalledWith(
        '洗牌后玩家手牌实体槽位与观测手牌数不一致',
        expect.objectContaining({
          reason: 'shufflePile:playerHandPlaceholderValidation',
          issues: expect.arrayContaining([
            expect.objectContaining({
              seatID: 4,
              observedHandCount: 2,
              expectedUnknownCount: 1,
              actualUnknownCount: 0
            })
          ])
        })
      )
    })

    const seat0Placeholder = room.cards.find(
      (card) => card.id === 0 && card.location === 'player' && card.seats.has(0)
    )
    const seat4Placeholder = room.cards.find(
      (card) =>
        card.id === 0 && card.location === 'player' && card.subZone === 'hand' && card.seats.has(4)
    )
    expect(seat0Placeholder).toBeTruthy()
    expect(seat4Placeholder).toBeTruthy()
    expect(seat4Placeholder!.entityID).toBeLessThan(0)
    expect(room.getPlayer(4).unknownCardCount).toBe(1)
    expect(suspendedHandIdentity.location).toBe('suspended')
    expect(suspendedHandIdentity.isKnown).toBe(true)

    withWarnSpy((warnSpy) => {
      room.moveCards([137, 113], 'process', {
        fromSeatID: 4,
        fromSubZone: 'hand',
        fromZone: null,
        fromSpellID: 27,
        spellID: 27,
        cardCount: 2,
        moveType: 3,
        position: POSITION_TOP,
        fromPosition: 65282,
        sourceEvent: { type: 'test:suspended-known-from-mismatched-player-hand' }
      })

      expect(warnSpy).not.toHaveBeenCalledWith(
        '玩家来源明牌未找到可立即置换的手牌占位',
        expect.anything()
      )
      expect(room.zones.get('process')!.cards).toEqual(
        expect.arrayContaining([suspendedHandIdentity, knownHandCard])
      )
      expect(suspendedHandIdentity.location).toBe('process')
      expect(suspendedHandIdentity.suspended).toBe(false)
      expect(knownHandCard.location).toBe('process')
      const fallbackSeat4Placeholder = room.cards.find(
        (card) => card.id === 0 && card.location === 'outside' && card.subZone === null
      )
      expect(fallbackSeat4Placeholder).toBeTruthy()
      expectConsistentPublicZones(room)
    })
  })

  it('暂停正 ID 后续从玩家手牌出现时使用保留暗占位置换', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 113, 137], seatIDs: [4] })
    const pile = getPile(room)
    const knownHandCard = room.cardIndex.get(113)!
    const suspendedHandIdentity = room.cardIndex.get(137)!

    pile.removeCard(knownHandCard)
    pile.removeCard(suspendedHandIdentity)
    knownHandCard.bindCandidates([4], 'hand', null, { known: true })
    suspendedHandIdentity.bindCandidates([4], 'hand', null, { known: false })
    room.getPlayer(4).syncObservedHandCount(2)

    room.shufflePile({ cardCount: 3 })

    const preservedPlaceholder = room.cards.find(
      (card) => card.id === 0 && card.location === 'player' && card.subZone === 'hand'
    )
    expect(preservedPlaceholder).toBeTruthy()
    expect(suspendedHandIdentity.location).toBe('suspended')
    expect(suspendedHandIdentity.isKnown).toBe(true)

    withWarnSpy((warnSpy) => {
      room.moveCards([137, 113], 'process', {
        fromSeatID: 4,
        fromSubZone: 'hand',
        fromZone: null,
        fromSpellID: 27,
        spellID: 27,
        cardCount: 2,
        moveType: 3,
        position: POSITION_TOP,
        fromPosition: 65282,
        sourceEvent: { type: 'test:suspended-known-from-player-hand' }
      })

      expect(warnSpy).not.toHaveBeenCalled()
      expect(room.zones.get('process')!.cards).toEqual(
        expect.arrayContaining([suspendedHandIdentity, knownHandCard])
      )
      expect(suspendedHandIdentity.location).toBe('process')
      expect(suspendedHandIdentity.suspended).toBe(false)
      expect(knownHandCard.location).toBe('process')
      expect(preservedPlaceholder!.location).toBe('outside')
      expect(room.getPlayer(4).unknownCardCount).toBe(0)
      expectConsistentPublicZones(room)
    })
  })

  it('洗牌后使用实际牌堆 ID 并暂停从未出现的暗手牌身份', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1] })
    const recycledCard = room.cardIndex.get(1)!
    const visibleHandCard = room.cardIndex.get(4)!
    const hiddenHandPlaceholder = room.cardIndex.get(5)!

    recycleIdsToDiscard(room, [1])
    getPile(room).removeCard(visibleHandCard)
    getPile(room).removeCard(hiddenHandPlaceholder)
    visibleHandCard.bindCandidates([1], 'hand', null, { known: true })
    hiddenHandPlaceholder.bindCandidates([1], 'hand', null, { known: false })
    room.getPlayer(1).syncObservedHandCount(2)

    room.shufflePile({ cardCount: 3 })

    expect(getPile(room).cards.map((card) => card.id)).toEqual([1, 2, 3])
    expect(getPile(room).cards).toHaveLength(3)
    expect(getDiscard(room).cards).toEqual([])
    expect(visibleHandCard.location).toBe('player')
    expect(visibleHandCard.suspended).toBe(false)
    ;[room.cardIndex.get(2)!, room.cardIndex.get(3)!].forEach((card) => {
      expect(card.location).toBe('pile')
      expect(card.suspended).toBe(false)
      expect(room.counter.cardInstances[card.id].status).toBe(0)
    })
    expect(hiddenHandPlaceholder.location).toBe('suspended')
    expect(hiddenHandPlaceholder.subZone).toBeNull()
    expect(hiddenHandPlaceholder.suspended).toBe(true)
    expect(hiddenHandPlaceholder.isKnown).toBe(true)
    expect(room.counter.cardInstances[hiddenHandPlaceholder.id].status).toBe(1)
    expect(getPublicFieldCandidateCards(room).map((card) => card.id)).toContain(
      hiddenHandPlaceholder.id
    )
    const placeholders = playerHandPlaceholders(room, 1)
    expect(placeholders).toHaveLength(1)
    expect(placeholders[0].seats.has(1)).toBe(true)
    expect(placeholders[0].isKnown).toBe(false)
    expect(room.getPlayer(1).unknownCardCount).toBe(1)
    expectConsistentPublicZones(room)
    expect(recycledCard.location).toBe('pile')
  })

  it('洗牌暂停暗标记正 ID 时按实体位置创建 id=0 替身', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1] })
    const visibleHandCard = room.cardIndex.get(4)!
    const hiddenMarkPlaceholder = room.cardIndex.get(5)!

    recycleIdsToDiscard(room, [1])
    getPile(room).removeCard(visibleHandCard)
    getPile(room).removeCard(hiddenMarkPlaceholder)
    visibleHandCard.bindCandidates([1], 'hand', null, { known: true })
    hiddenMarkPlaceholder.bindCandidates([1], 'hand', null, { known: false })
    room.getPlayer(1).syncObservedHandCount(2)

    room.moveCards([0], 'player', {
      seatID: 1,
      fromSeatID: 1,
      fromZone: 5,
      fromSubZone: 'hand',
      subZone: 'mark',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:hidden-mark-before-shuffle' }
    })

    const record = room.getSkillState('hiddenMarkCandidates').records.get('1:1:700')
    expect(record.placeholderCards.has(hiddenMarkPlaceholder)).toBe(true)

    room.shufflePile({ cardCount: 3 })

    const updatedRecord = room.getSkillState('hiddenMarkCandidates').records.get('1:1:700')
    const placeholderCards = Array.from(updatedRecord.placeholderCards) as Card[]
    const currentPlaceholder = placeholderCards[0]

    expect(updatedRecord.placeholderCards.has(hiddenMarkPlaceholder)).toBe(false)
    expect(placeholderCards).toHaveLength(1)
    expect(currentPlaceholder).not.toBe(hiddenMarkPlaceholder)
    expect(currentPlaceholder.id).toBe(0)
    expect(currentPlaceholder.location).toBe('player')
    expect(currentPlaceholder.subZone).toBe('mark')
    expect(currentPlaceholder.spellID).toBe(700)
    expect(currentPlaceholder.isKnown).toBe(false)
    expect(currentPlaceholder.seats.has(1)).toBe(true)
    expect(hiddenMarkPlaceholder.location).toBe('suspended')
    expect(hiddenMarkPlaceholder.subZone).toBeNull()
    expect(hiddenMarkPlaceholder.suspended).toBe(true)
    expect(hiddenMarkPlaceholder.isKnown).toBe(true)
    expect(getPublicFieldCandidateCards(room)).toContain(hiddenMarkPlaceholder)
    expect(room.cards.filter((card) => card.id === 0)).toHaveLength(1)
    expectConsistentPublicZones(room)
  })

  it('木牛流马完整快照来源为技能空间时仍置换当前承载者实体占位', () => {
    const { room } = createTestRoom({ cardIDs: [11, 12, 73, 105], seatIDs: [7] })
    const pile = getPile(room)
    const visibleMarkCards = getCards(room, [11, 12])
    const hiddenMarkCards = getCards(room, [73, 105])

    hiddenMarkCards.forEach((card) => {
      pile.removeCard(card)
      card.bindCandidates([7], 'mark', 700, { known: false })
    })

    room.moveCards(
      visibleMarkCards.map((card) => card.id),
      'player',
      {
        seatID: 7,
        fromZone: 700,
        fromSubZone: 'mark',
        fromSpellID: 700,
        subZone: 'mark',
        spellID: 700,
        cardCount: 2,
        sourceEvent: { type: 'test:observed-mount-mark-snapshot-from-space' }
      }
    )

    visibleMarkCards.forEach((card) => {
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('mark')
      expect(card.spellID).toBe(700)
      expect(card.seats.has(7)).toBe(true)
      expect(card.isKnown).toBe(true)
    })
    hiddenMarkCards.forEach((card) => {
      expect(card.location).toBe('pile')
      expect(card.subZone).toBeNull()
      expect(card.seats.has(7)).toBe(false)
    })
    expect(
      room.cards.filter(
        (card) =>
          hiddenMarkCards.includes(card) &&
          card.location === 'player' &&
          card.subZone === 'mark' &&
          card.spellID === 700 &&
          card.seats.has(7)
      )
    ).toHaveLength(0)
    expectConsistentPublicZones(room)
  })

  it('木牛流马出现完整明牌快照时用明牌置换 id=0 实体位置替身', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 11, 12, 73, 105], seatIDs: [7] })
    const pile = getPile(room)
    const visibleHandCard = room.cardIndex.get(1)!
    const visibleMarkCards = getCards(room, [11, 12])
    const hiddenMarkCards = getCards(room, [73, 105])

    pile.removeCard(visibleHandCard)
    visibleHandCard.bindCandidates([7], 'hand', null, { known: true })
    hiddenMarkCards.forEach((card) => {
      pile.removeCard(card)
      card.bindCandidates([7], 'hand', null, { known: false })
    })
    room.getPlayer(7).syncObservedHandCount(3)

    room.moveCards([0, 0], 'player', {
      seatID: 7,
      fromSeatID: 7,
      fromZone: 5,
      fromSubZone: 'hand',
      subZone: 'mark',
      spellID: 700,
      cardCount: 2,
      sourceEvent: { type: 'test:hidden-mount-mark-before-shuffle' }
    })

    room.shufflePile({ cardCount: 4 })

    const preservedMarkPlaceholders = room.cards.filter(
      (card) =>
        card.id === 0 &&
        card.location === 'player' &&
        card.subZone === 'mark' &&
        card.spellID === 700 &&
        card.seats.has(7)
    )
    expect(preservedMarkPlaceholders).toHaveLength(2)
    hiddenMarkCards.forEach((card) => {
      expect(card.location).toBe('suspended')
      expect(card.isKnown).toBe(true)
    })

    room.moveCards(
      visibleMarkCards.map((card) => card.id),
      'player',
      {
        seatID: 7,
        fromSubZone: 'mark',
        fromSpellID: 700,
        subZone: 'mark',
        spellID: 700,
        cardCount: 2,
        sourceEvent: { type: 'test:observed-mount-mark-full-snapshot' }
      }
    )

    expect(
      room.cards.filter(
        (card) =>
          card.id === 0 &&
          card.location === 'player' &&
          card.subZone === 'mark' &&
          card.spellID === 700 &&
          card.seats.has(7)
      )
    ).toHaveLength(0)
    preservedMarkPlaceholders.forEach((card) => {
      expect(card.location).toBe('pile')
      expect(card.subZone).toBeNull()
    })
    visibleMarkCards.forEach((card) => {
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('mark')
      expect(card.spellID).toBe(700)
      expect(card.seats.has(7)).toBe(true)
      expect(card.isKnown).toBe(true)
    })
    expectConsistentPublicZones(room)
  })

  it('牌顶已是连续明牌时来源占位回补插到明牌段下方', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5, 6], seatIDs: [1] })
    const pile = getPile(room)
    const topKnownIDs = [4, 5, 6]
    const revealedIDs = [1, 2]

    topKnownIDs.forEach((id) => room.cardIndex.get(id)!.confirmKnown())
    // 手牌用瞬时匿名占位；真实身份 1/2 仍留在牌堆，揭开时会触发公共区占位回补。
    const placeholders = room.createExternalCards([], 2)
    placeholders.forEach((card) => {
      card.bindCandidates([1], 'hand', null, { known: false })
    })
    room.getPlayer(1).syncObservedHandCount(2)

    room.moveCards(revealedIDs, 'process', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      cardCount: revealedIDs.length,
      sourceEvent: { type: 'test:reveal-hand-after-known-pile-top' }
    })

    expect(
      getPileDisplayCards(pile.cards)
        .slice(0, 3)
        .map((card) => card.id)
    ).toEqual([6, 5, 4])
    expect(
      getPileDisplayCards(pile.cards)
        .slice(0, 3)
        .every((card) => card.isKnown)
    ).toBe(true)
    const knownSegmentStart = pile.cards.length - topKnownIDs.length
    expect(pile.cards.slice(knownSegmentStart - placeholders.length, knownSegmentStart)).toEqual(
      expect.arrayContaining(placeholders)
    )
    placeholders.forEach((card) => {
      expect(card.location).toBe('pile')
      expect(pile.cards).toContain(card)
    })
    expect(pile.cards.slice(-3).map((card) => card.id)).toEqual([4, 5, 6])
    expectConsistentPublicZones(room)
  })

  it.each([
    {
      name: '实体占位揭示为牌堆明牌时回到牌堆但不顶回明牌位置',
      sourceEvent: 'test:reveal-hidden-pile-card',
      setupCandidate: null as null | ((room: Room, candidateCard: Card) => void),
      expectedPileIds: [1, 3, 4],
      unexpectedPileIds: [1, 4, 3] as number[] | null
    },
    {
      name: '实体占位揭示为牌堆候选牌时继续占住候选位置',
      sourceEvent: 'test:reveal-hidden-public-candidate',
      setupCandidate: (_room: Room, candidateCard: Card) => {
        candidateCard.setLocationCandidates([
          {
            type: 'public',
            zone: 'pile',
            position: 'bottom',
            count: 3
          }
        ])
      },
      expectedPileIds: [1, 4, 3],
      unexpectedPileIds: null
    }
  ])('$name', ({ sourceEvent, setupCandidate, expectedPileIds, unexpectedPileIds }) => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4], seatIDs: [1] })
    const pile = getPile(room)
    const candidateCard = room.cardIndex.get(2)!
    const [placeholder] = pile.remove(1, POSITION_TOP)

    room.cards.forEach((card) => {
      if (card.id > 0 && card !== placeholder) card.confirmKnown()
    })
    setupCandidate?.(room, candidateCard)
    placeholder.bindCandidates([1], 'hand', null, { known: false })

    room.moveCards([2], 'discard', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: sourceEvent }
    })

    expect(pile.cards.map((card) => card.id)).toEqual(expectedPileIds)
    if (unexpectedPileIds) {
      expect(pile.cards.map((card) => card.id)).not.toEqual(unexpectedPileIds)
    }
    expect(placeholder.location).toBe('pile')
    expectConsistentPublicZones(room)
  })

  it.each([
    {
      name: '玩家来源明牌仍残留牌堆时用来源占位回补牌堆槽位',
      cardIDs: [1, 2, 3, 4, 5],
      knownId: 2,
      sourceEvent: 'test:player-source-public-residue',
      setup(room: Room) {
        const placeholder = room.cardIndex.get(5)!
        getPile(room).removeCard(placeholder)
        placeholder.bindCandidates([1], 'hand', null, { known: true })
        room.getPlayer(1).syncObservedHandCount(1)
        return placeholder
      },
      assert(room: Room, knownCard: Card, placeholder: Card, pileCountBefore: number) {
        const pile = getPile(room)
        expect(pile.cards).toHaveLength(pileCountBefore)
        expect(pile.cards).toContain(placeholder)
        expect(pile.cards).not.toContain(knownCard)
        expect(getDiscard(room).cards).toContain(knownCard)
        expect(placeholder.location).toBe('pile')
      }
    },
    {
      name: 'id=0 暗占位揭示为牌堆明牌时仍回补牌堆槽位',
      cardIDs: [1, 2, 3, 4],
      knownId: 2,
      sourceEvent: 'test:player-source-id-zero-placeholder',
      setup(room: Room) {
        const [placeholder] = room.createExternalCards([], 1)
        placeholder.bindCandidates([1], 'hand', null, { known: false })
        room.getPlayer(1).syncObservedHandCount(1)
        return placeholder
      },
      assert(room: Room, knownCard: Card, placeholder: Card, pileCountBefore: number) {
        const pile = getPile(room)
        expect(pile.cards).toHaveLength(pileCountBefore)
        expect(pile.cards).toContain(placeholder)
        expect(pile.cards).not.toContain(knownCard)
        expect(getDiscard(room).cards).toContain(knownCard)
        expect(placeholder.location).toBe('pile')
      }
    }
  ])('$name', ({ cardIDs, knownId, sourceEvent, setup, assert }) => {
    const { room } = createTestRoom({ cardIDs, seatIDs: [1] })
    const pile = getPile(room)
    const knownCard = room.cardIndex.get(knownId)!
    const placeholder = setup(room)
    const pileCountBefore = pile.cards.length

    room.moveCards([knownId], 'discard', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: sourceEvent }
    })

    assert(room, knownCard, placeholder, pileCountBefore)
    expectConsistentPublicZones(room)
  })

  it('公共来源端点明牌回填旧公共槽位时保留已知状态', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1] })
    const pile = getPile(room)
    const knownCard = room.cardIndex.get(2)!
    const sourceEndpoint = room.cardIndex.get(4)!
    const playerPlaceholder = room.cardIndex.get(5)!

    pile.removeCard(playerPlaceholder)
    playerPlaceholder.bindCandidates([1], 'hand', null, { known: false })
    room.getPlayer(1).syncObservedHandCount(1)
    // 来源端点的身份已经由其它协议确认，回填只应迁移位置而不能重新盖暗。
    sourceEndpoint.confirmKnown()

    room.moveCards([knownCard.id], 'discard', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'test:known-public-source-placeholder' }
    })

    expect(sourceEndpoint.location).toBe('pile')
    expect(sourceEndpoint.isKnown).toBe(true)
    expect(pile.cards).toContain(sourceEndpoint)
    expect(getDiscard(room).cards).toContain(knownCard)
    expectConsistentPublicZones(room)
  })

  it('未观测来源手牌总数时不使用已知手牌回补公共区槽位', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1] })
    const pile = getPile(room)
    const knownCard = room.cardIndex.get(2)!
    const knownHandCard = room.cardIndex.get(5)!

    pile.removeCard(knownHandCard)
    knownHandCard.bindCandidates([1], 'hand', null, { known: true })
    const pileCountBefore = pile.cards.length

    room.moveCards([2], 'discard', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'test:unobserved-player-source-public-residue' }
    })

    const fallbackPlaceholder = pile.cards.find((card) => card.id === 0)

    expect(room.getPlayer(1).hasObservedHandCount).toBe(false)
    expect(pile.cards).toHaveLength(pileCountBefore)
    expect(pile.cards).not.toContain(knownCard)
    expect(pile.cards).not.toContain(knownHandCard)
    expect(fallbackPlaceholder).toBeTruthy()
    expect(fallbackPlaceholder?.location).toBe('pile')
    expect(knownHandCard.location).toBe('player')
    expect(knownHandCard.subZone).toBe('hand')
    expect(getDiscard(room).cards).toContain(knownCard)
    expectConsistentPublicZones(room)
  })

  it('批量弃牌时不把同批已知牌当作其它明牌的来源占位', () => {
    const { room } = createTestRoom({ cardIDs: [76, 91, 122, 200], seatIDs: [1] })
    const pile = getPile(room)
    const publicKnownCard = room.cardIndex.get(76)!
    const batchKnownPlaceholder = room.cardIndex.get(91)!
    const sparePlaceholder = room.cardIndex.get(122)!

    withWarnSpy((warnSpy) => {
      pile.removeCard(batchKnownPlaceholder)
      pile.removeCard(sparePlaceholder)
      batchKnownPlaceholder.bindCandidates([1], 'hand', null, { known: false })
      sparePlaceholder.bindCandidates([1], 'hand', null, { known: false })
      room.getPlayer(1).syncObservedHandCount(2)
      const pileCountBefore = pile.cards.length

      room.moveCards([91, 76], 'discard', {
        fromSeatID: 1,
        fromSubZone: 'hand',
        cardCount: 2,
        sourceEvent: { type: 'test:batch-known-reserved-from-placeholder' }
      })

      expect(pile.cards).toHaveLength(pileCountBefore)
      expect(pile.cards).toContain(sparePlaceholder)
      expect(pile.cards).not.toContain(batchKnownPlaceholder)
      expect(pile.cards).not.toContain(publicKnownCard)
      expect(getDiscard(room).cards).toEqual(
        expect.arrayContaining([batchKnownPlaceholder, publicKnownCard])
      )
      expect(warnSpy).not.toHaveBeenCalled()
      expectConsistentPublicZones(room)
    })
  })
})
