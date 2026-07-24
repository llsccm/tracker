import { describe, expect, it, vi } from 'vitest'

import { trackerLogger } from '@/utils/logger'
import { createTestRoom, getCard } from './helpers/room'

describe('known 路径落弃明牌确认', () => {
  it('12区补建的已知牌正常点亮且不计入既有暗实体诊断', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [0] })
    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})

    try {
      room.moveCards([61036], 'player', {
        fromZone: 'exile',
        seatID: 0,
        subZone: 'hand',
        cardCount: 1
      })

      const card = room.cardIndex.get(61036)
      expect(card?.location).toBe('player')
      expect(card?.subZone).toBe('hand')
      expect(card?.isKnown).toBe(true)
      expect(infoSpy).not.toHaveBeenCalledWith('已知牌解析后补确认明牌', expect.anything())
    } finally {
      infoSpy.mockRestore()
    }
  })

  it('12区既有正 ID 暗实体仍触发兜底诊断', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [0] })
    const existingCard = room.createExternalCards([61037], 1)[0]
    room.zones.get('exile')!.add(existingCard)
    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})

    try {
      room.moveCards([61037], 'player', {
        fromZone: 'exile',
        seatID: 0,
        subZone: 'hand',
        cardCount: 1
      })

      expect(infoSpy).toHaveBeenCalledWith(
        '已知牌解析后补确认明牌',
        expect.objectContaining({
          confirmedFromUnknownIDs: [61037],
          createdCardIDs: [],
          knownCardCreationReason: 'external-source'
        })
      )
    } finally {
      infoSpy.mockRestore()
    }
  })

  it('createExternal 补建的正 ID 进入弃牌堆时应 confirmKnown', () => {
    // 处理区无匿名槽 + 正 ID 50 不在 cardIndex：
    // materialize(50, null) 失败 → missingIDs → createExternalCards([50])。
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })
    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})

    try {
      room.moveCards([50], 'discard', {
        fromZone: 'process',
        cardCount: 1
      })
      expect(infoSpy).toHaveBeenCalledWith(
        '已知牌解析后补确认明牌',
        expect.objectContaining({
          confirmedFromUnknownIDs: [50],
          createdCardIDs: [50],
          fromZone: 'process',
          knownCardCreationReason: 'known-fallback'
        })
      )
    } finally {
      infoSpy.mockRestore()
    }

    const card = room.cardIndex.get(50)
    expect(card).toBeTruthy()
    expect(card!.location).toBe('discard')
    expect(card!.isKnown).toBe(true)
    expect(room.zones.get('discard')!.cards).toContain(card!)
  })

  it('处理区中的正 ID 暗实体经 known 落弃后应被点亮', () => {
    const { room } = createTestRoom({ cardIDs: [29, 50, 113], seatIDs: [1] })
    const processZone = room.zones.get('process')!
    const pile = room.zones.get('pile')!

    ;[29, 50, 113].forEach((id) => {
      const card = room.cardIndex.get(id)!
      pile.removeCard(card)
      card.isKnown = false
      processZone.add(card)
    })

    room.moveCards([29, 50, 113], 'discard', {
      fromZone: 'process',
      cardCount: 3
    })
    ;[29, 50, 113].forEach((id) => {
      const card = room.cardIndex.get(id)!
      expect(card.location).toBe('discard')
      expect(card.isKnown).toBe(true)
    })
  })

  it('手牌 known 缺实体时 createExternal，且不消费木马 700 匿名占位', () => {
    // 普通出牌/进处理区不得借用 mark:700；木马占位应保留。
    const { room } = createTestRoom({ cardIDs: [29, 113], seatIDs: [3] })
    const pile = room.zones.get('pile')!
    const player = room.getPlayer(3)!

    const card29 = getCard(room, 29)!
    const card113 = getCard(room, 113)!
    pile.removeCard(card29)
    pile.removeCard(card113)
    card29.bindCandidates([3], 'hand', null, { known: true })
    card113.bindCandidates([3], 'hand', null, { known: true })

    const markPlaceholder = room.createExternalCards([], 1)[0]!
    const markEntityID = markPlaceholder.entityID
    markPlaceholder.bindCandidates([3], 'mark', 700, { known: false })
    player.syncObservedHandCount(2)
    room.resolveConstraints()

    room.deckIdentities.add(50)
    room.unlocatedIdentities.add(50)

    room.moveCards([29, 50, 113], 'process', {
      fromSeatID: 3,
      fromSubZone: 'hand',
      fromZone: null,
      cardCount: 3,
      spellID: 423
    })

    expect(
      room.zones
        .get('process')!
        .cards.map((card) => card.id)
        .sort((a, b) => a - b)
    ).toEqual([29, 50, 113])
    expect(room.cardIndex.get(50)!.isKnown).toBe(true)
    // 700 匿名占位不得被 hand known 出牌偷走
    const stillMark = room.cards.find(
      (card) =>
        card.entityID === markEntityID ||
        (card.location === 'player' &&
          card.subZone === 'mark' &&
          card.spellID === 700 &&
          card.seats.has(3) &&
          isAnonymousLike(card))
    )
    expect(stillMark).toBeTruthy()
    expect(stillMark!.subZone).toBe('mark')
    expect(stillMark!.spellID).toBe(700)
  })

  it('普通 hand→process known 单牌缺实体时 createExternal 且不消费木马占位', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [3] })
    room.deckIdentities.add(91)
    room.unlocatedIdentities.add(91)

    const markPlaceholder = room.createExternalCards([], 1)[0]!
    const markEntityID = markPlaceholder.entityID
    markPlaceholder.bindCandidates([3], 'mark', 700, { known: false })

    room.moveCards([91], 'process', {
      fromSeatID: 3,
      fromSubZone: 'hand',
      fromZone: null,
      cardCount: 1,
      spellID: 0
    })

    expect(room.cardIndex.get(91)!.location).toBe('process')
    expect(room.cardIndex.get(91)!.isKnown).toBe(true)
    const markStill = room.cards.find((card) => card.entityID === markEntityID)
    expect(markStill?.subZone).toBe('mark')
    expect(markStill?.spellID).toBe(700)
  })
})

function isAnonymousLike(card: { id: number; entityID: number }) {
  return !(card.id > 0) || card.entityID < 0
}
