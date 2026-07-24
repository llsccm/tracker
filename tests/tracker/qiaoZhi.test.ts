import { describe, expect, it } from 'vitest'

import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

describe('巧织暗取牌推断', () => {
  it('明弃未选牌后用展示牌差集确认暗取牌身份', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 3, ClientID: 300 }], 300)
    controller.initTrackerDeck([37, 92])

    controller.syncTrackerMove(
      protocolMove({
        CardCount: 2,
        CardIDs: [37, 92],
        FromID: 255,
        FromZone: 1,
        MoveType: 6,
        SpellID: 3544,
        ToID: 255,
        ToZone: 8
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [],
        FromID: 3544,
        FromZone: 8,
        MoveType: 18,
        SpellID: 3544,
        ToID: 3,
        ToZone: 5
      })
    )

    const room = controller.getTrackerRoom()
    const anonymousHandCardsBefore = room.cards.filter(
      (card) =>
        card.entityID < 0 &&
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(3)
    )
    expect(anonymousHandCardsBefore).toHaveLength(1)

    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [92],
        FromID: 3544,
        FromZone: 8,
        MoveType: 4,
        SpellID: 3544,
        ToID: 255,
        ToZone: 2
      })
    )

    const selectedCard = room.cardIndex.get(37)!
    const discardedCard = room.cardIndex.get(92)!
    const anonymousHandCardsAfter = room.cards.filter(
      (card) =>
        card.entityID < 0 &&
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(3)
    )

    expect(selectedCard.location).toBe('player')
    expect(selectedCard.subZone).toBe('hand')
    expect(selectedCard.seats.has(3)).toBe(true)
    // 差集确认落手必须是普通手牌，不能残留 spellID=3544 / 模糊 hand/巧织 描述
    expect(selectedCard.spellID).toBeNull()
    expect(selectedCard.isKnown).toBe(true)
    expect(selectedCard.hasLocationCandidates?.()).toBe(false)
    expect(selectedCard.getLocationDescription()).not.toMatch(/巧织/)
    expect(discardedCard.location).toBe('discard')
    expect(room.zones.get('discard')!.cards).toContain(discardedCard)
    expect(anonymousHandCardsAfter).toEqual([])
    expect(
      room.cards.filter(
        (card) => card.location === 'player' && card.subZone === 'mark' && card.spellID === 3544
      )
    ).toEqual([])
    expect(room.skillState.has('qiaozhiSelection')).toBe(false)
  })

  it('暗取协议已带正 CardIDs 时跳过差集推断（主视角可见）', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 3, ClientID: 300 }], 300)
    controller.initTrackerDeck([52, 77])

    controller.syncTrackerMove(
      protocolMove({
        CardCount: 2,
        CardIDs: [52, 77],
        FromID: 255,
        FromZone: 1,
        MoveType: 6,
        SpellID: 3544,
        ToID: 255,
        ToZone: 8
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [52],
        FromID: 3544,
        FromZone: 8,
        MoveType: 18,
        SpellID: 3544,
        ToID: 3,
        ToZone: 5
      })
    )

    const room = controller.getTrackerRoom()
    // 已给出选取明牌：差集状态应被清掉，等待差集不应建立
    expect(room.skillState.has('qiaozhiSelection')).toBe(false)

    const selectedCard = room.cardIndex.get(52)!
    expect(selectedCard.location).toBe('player')
    expect(selectedCard.subZone).toBe('hand')
    expect(selectedCard.seats.has(3)).toBe(true)
    expect(selectedCard.isKnown).toBe(true)
  })

  it('差集确认后的牌再暗置木马时不应残留巧织标记描述', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 3, ClientID: 300 }], 300)
    controller.initTrackerDeck([141, 75, 161])

    // 木马装备
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [161],
        FromID: 255,
        FromZone: 1,
        MoveType: 2,
        SpellID: 0,
        ToID: 3,
        ToZone: 6
      })
    )

    // 巧织展示 + 暗取 + 明弃差集 → 141 入手
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 2,
        CardIDs: [141, 75],
        FromID: 255,
        FromZone: 1,
        MoveType: 6,
        SpellID: 3544,
        ToID: 255,
        ToZone: 8
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [],
        FromID: 3544,
        FromZone: 8,
        MoveType: 18,
        SpellID: 3544,
        ToID: 3,
        ToZone: 5
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [75],
        FromID: 3544,
        FromZone: 8,
        MoveType: 4,
        SpellID: 3544,
        ToID: 255,
        ToZone: 2
      })
    )

    const room = controller.getTrackerRoom()
    const card141 = room.cardIndex.get(141)!
    expect(card141.subZone).toBe('hand')
    expect(card141.spellID).toBeNull()

    // 暗置 1 张进木马 700（可能就是 141）
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [],
        FromID: 3,
        FromZone: 5,
        MoveType: 15,
        SpellID: 700,
        ToID: 3,
        ToZone: 4,
        ToZoneParam: 700
      })
    )

    // 若 141 仍在手牌候选/被标成标记，描述不得再带巧织
    expect(card141.getLocationDescription()).not.toMatch(/巧织/)
    if (card141.subZone === 'mark') {
      expect(card141.spellID === 700 || card141.hasLocationCandidates?.()).toBe(true)
    }
  })
})
