import { describe, expect, it } from 'vitest'
import { getPopupSpaceCards } from '@/tracker/room/movement/popupSpaces'

import { protocolMove, createReadyControllerHarness } from './helpers/trackerController'

describe('巧织默认协议管线', () => {
  it('明弃未选牌后由通用数量约束确认暗取牌身份', () => {
    const { controller } = createReadyControllerHarness({
      seatIDs: [3],
      currentUserID: 300,
      cardIDs: [37, 92]
    })

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
    expect(anonymousHandCardsBefore).toHaveLength(0)
    expect(room.getPlayer(3)!.candidateHandCards).toHaveLength(2)
    expect(room.getPlayer(3)!.observedHandCount).toBe(1)

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
    // 收敛后的牌必须是普通手牌，不能残留 spellID=3544 / 模糊 hand/巧织 描述
    expect(selectedCard.spellID).toBeNull()
    expect(selectedCard.isKnown).toBe(true)
    expect(selectedCard.hasLocationCandidates?.()).toBe(false)
    expect(selectedCard.getLocationDescription()).not.toMatch(/巧织/)
    expect(discardedCard.location).toBe('discard')
    expect(room.zones.get('discard')!.cards).toContain(discardedCard)
    expect(anonymousHandCardsAfter).toEqual([])
    expect(
      room.cards.filter((card) => card.location === 'popup' && card.popupSpaceID === 3544)
    ).toEqual([])
  })

  it('主视角暗取协议已带正 CardIDs 时直接确认手牌', () => {
    const { controller } = createReadyControllerHarness({
      seatIDs: [3],
      currentUserID: 300,
      cardIDs: [52, 77]
    })

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

    const selectedCard = room.cardIndex.get(52)!
    expect(selectedCard.location).toBe('player')
    expect(selectedCard.subZone).toBe('hand')
    expect(selectedCard.seats.has(3)).toBe(true)
    expect(selectedCard.isKnown).toBe(true)
  })

  it('确认入手后的牌再暗置木马时不应残留巧织标记描述', () => {
    const { controller } = createReadyControllerHarness({
      seatIDs: [3],
      currentUserID: 300,
      cardIDs: [141, 75, 161]
    })

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

    // 巧织展示 + 暗取 + 剩余明弃 → 141 入手
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

  it.each(['before-discard', 'after-discard', 'visible-move'])(
    '角色数据通知 %s 不改变移动协议与通用约束推导的身份',
    (timing) => {
      const { controller, room } = createReadyControllerHarness({
        seatIDs: [3],
        currentUserID: 300,
        cardIDs: [37, 92]
      })
      controller.syncTrackerMove(
        protocolMove({
          CardCount: 2,
          CardIDs: [37, 92],
          FromZone: 1,
          ToID: 255,
          ToZone: 8,
          MoveType: 6,
          SpellID: 3544
        })
      )
      controller.syncTrackerMove(
        protocolMove({
          CardCount: 1,
          CardIDs: timing === 'visible-move' ? [37] : [],
          FromID: 3544,
          FromZone: 8,
          ToID: 3,
          ToZone: 5,
          MoveType: 18,
          SpellID: 3544
        })
      )
      const notifyRoleData = () =>
        controller.dispatchSkillProtocolEvent({
          type: 'roleData',
          message: { DataID: 3544, SeatID: 3, Datas: [37, 0] }
        })
      if (timing !== 'after-discard') notifyRoleData()
      const player = room.getPlayer(3)!
      expect(player.observedHandCount).toBe(1)
      expect(player.knownHandCards.map((card) => card.id)).toEqual(
        timing === 'visible-move' ? [37] : []
      )
      expect(player.candidateHandCards.map((card) => card.id).sort((a, b) => a - b)).toEqual(
        timing === 'visible-move' ? [] : [37, 92]
      )
      controller.syncTrackerMove(
        protocolMove({
          CardCount: 1,
          CardIDs: [92],
          FromID: 3544,
          FromZone: 8,
          ToID: 255,
          ToZone: 2,
          MoveType: 4,
          SpellID: 3544
        })
      )
      const revision = room.pileIdentityLedger.getSnapshot().revision
      notifyRoleData()
      controller.dispatchSkillProtocolEvent({
        type: 'roleData',
        message: { DataID: 3544, SeatID: 3, Datas: [0, 0] }
      })
      expect(room.pileIdentityLedger.getSnapshot().revision).toBe(revision)
      expect(player.observedHandCount).toBe(1)
      expect(player.knownHandCards.map((card) => card.id)).toEqual([37])
      expect(player.candidateHandCards).toEqual([])
      expect(player.unknownCardCount).toBe(0)
      expect(room.cardIndex.get(37)!.getPossibleLocations()).toEqual([
        { type: 'player', seatID: 3, subZone: 'hand', spellID: null }
      ])
      expect(room.cards).toHaveLength(2)
      expect(getPopupSpaceCards(room, 3544)).toEqual([])
      expect(room.assertPileIdentityLedgerConsistency('qiaoZhi:roleData')).toEqual([])
    }
  )
})
