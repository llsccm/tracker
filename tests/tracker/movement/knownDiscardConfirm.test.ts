import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { describe, expect, it, vi } from 'vitest'

import { trackerLogger } from '@/utils/logger'
import { createTestRoom, getCard } from '../helpers/room'

describe('known 路径落弃明牌确认', () => {
  it('12区补建的已知牌正常点亮且不计入既有暗实体诊断', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [0] })
    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})

    try {
      room.moveCards([61036], {
        from: { type: 'public', zone: 'exile', position: POSITION_TOP },
        to: { type: 'player', seatID: 0, subZone: 'hand' },
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
      room.moveCards([61037], {
        from: { type: 'public', zone: 'exile', position: POSITION_TOP },
        to: { type: 'player', seatID: 0, subZone: 'hand' },
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
      room.moveCards([50], {
        from: { type: 'public', zone: 'process', position: POSITION_TOP },
        to: { type: 'public', zone: 'discard', position: POSITION_TOP },
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
      const card = getCard(room, id)!
      pile.removeCard(card)
      card.isKnown = false
      processZone.add(card)
    })

    room.moveCards([29, 50, 113], {
      from: { type: 'public', zone: 'process', position: POSITION_TOP },
      to: { type: 'public', zone: 'discard', position: POSITION_TOP },
      cardCount: 3
    })
    ;[29, 50, 113].forEach((id) => {
      const card = room.cardIndex.get(id)!
      expect(card.location).toBe('discard')
      expect(card.isKnown).toBe(true)
    })
  })

  it.each([
    {
      scenario: '批量中部分缺失',
      deckIDs: [29, 113],
      knownHandIDs: [29, 113],
      playedIDs: [29, 50, 113],
      missingID: 50,
      observedHandCount: 2,
      triggerSpellID: 423
    },
    {
      scenario: '单张缺失',
      deckIDs: [1],
      knownHandIDs: [],
      playedIDs: [91],
      missingID: 91,
      observedHandCount: null,
      triggerSpellID: 0
    }
  ])(
    '手牌 known $scenario 时补建明牌进入处理区，保留木马 700 匿名占位',
    ({ deckIDs, knownHandIDs, playedIDs, missingID, observedHandCount, triggerSpellID }) => {
      const seatID = 3
      const { room } = createTestRoom({ cardIDs: deckIDs, seatIDs: [seatID] })
      const pile = room.zones.get('pile')!
      for (const id of knownHandIDs) {
        const card = getCard(room, id)!
        pile.removeCard(card)
        card.bindCandidates([seatID], 'hand', null, { known: true })
      }

      const markPlaceholder = room.createExternalCards([], 1)[0]!
      const markEntityID = markPlaceholder.entityID
      markPlaceholder.bindCandidates([seatID], 'mark', 700, { known: false })
      if (observedHandCount !== null) {
        room.getPlayer(seatID)!.syncObservedHandCount(observedHandCount)
        room.resolveConstraints()
      }

      room.deckIdentities.add(missingID)
      room.unlocatedIdentities.add(missingID)
      room.moveCards(playedIDs, {
        from: { type: 'player', seatID, subZone: 'hand' },
        to: { type: 'public', zone: 'process', position: POSITION_TOP },
        triggerSpellID,
        cardCount: playedIDs.length
      })

      expect(
        room.zones
          .get('process')!
          .cards.map((card) => card.id)
          .sort((a, b) => a - b)
      ).toEqual(playedIDs)
      expect(room.cardIndex.get(missingID)).toMatchObject({ location: 'process', isKnown: true })
      // 普通出牌不能借用 mark:700 的实体，也不能用新占位替换原实体。
      const stillMark = room.cards.find((card) => card.entityID === markEntityID)
      expect(stillMark).toBe(markPlaceholder)
      expect(stillMark).toMatchObject({ location: 'player', subZone: 'mark', spellID: 700 })
      expect(stillMark!.seats.has(seatID)).toBe(true)
      expect(stillMark!.isAnonymous).toBe(true)
    }
  )
})
