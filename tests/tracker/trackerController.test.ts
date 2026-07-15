import { describe, expect, it, vi } from 'vitest'
import { TrackerController } from '@/tracker/runtime/trackerController'
import {
  createTrackerControllerHarness,
  protocolMove,
  returnToPileMove
} from './helpers/trackerController'

describe('TrackerController', () => {
  it('未注入 gameState 时使用 Room 自身默认状态', () => {
    const controller = new TrackerController()

    controller.initTrackerRoom()

    const room = controller.getTrackerRoom()
    expect(room.game).toBeTruthy()
    expect(typeof room.game.getCurrentTimestamp).toBe('function')
  })

  it('Room 未创建时不缓存玩家与先手生命周期', () => {
    const seatReads = []
    const { controller, gameState } = createTrackerControllerHarness({
      getSeatUIs: () => seatReads.push('read')
    })

    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.setTrackerFirstHand(1)
    controller.initTrackerRoom()

    const room = controller.getTrackerRoom()
    expect(room.mySeatID).toBeUndefined()
    expect(room.firstID).toBeUndefined()
    expect(gameState.seatIDs).toEqual([])
    expect(seatReads).toEqual([])
  })

  it('录像主视角确定后同步座位并重排 SeatUI', () => {
    const seatReads = []
    const { controller, gameState, view } = createTrackerControllerHarness({
      getSeatUIs: () => seatReads.push('read')
    })

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: 1, ClientID: 100 },
        { SeatID: 2, ClientID: 200 }
      ],
      999
    )
    controller.setTrackerFirstHand(1)

    seatReads.length = 0
    const renderCount = view.calls.scheduleRender

    controller.setTrackerMySeatID(2)
    controller.setTrackerMySeatID(1)

    const room = controller.getTrackerRoom()
    expect(room.mySeatID).toBe(2)
    expect(gameState.myID).toBe(2)
    expect(seatReads).toEqual(['read'])
    expect(view.calls.scheduleRender).toBe(renderCount + 1)
  })

  it('通过注入依赖管理房间生命周期', () => {
    const seatReads = []
    const { controller, gameState, view } = createTrackerControllerHarness({
      getSeatUIs: () => seatReads.push('read')
    })

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.setTrackerFirstHand(1)
    controller.initTrackerDeck([1, 2])

    const room = controller.getTrackerRoom()
    expect(room.mySeatID).toBe(1)
    expect(room.firstID).toBe(1)
    expect(gameState.room).toBe(room)
    expect(gameState.seatIDs).toEqual([1])
    expect(view.calls.mount).toBe(2)
    expect(view.calls.scheduleRender).toBe(2)
    expect(seatReads).toEqual(['read'])
  })

  it('先手已设置时忽略重复同步并警告冲突座位', () => {
    const warnCalls = []
    const seatReads = []
    const { controller, view } = createTrackerControllerHarness({
      getSeatUIs: () => seatReads.push('read'),
      logger: {
        warn(...args) {
          warnCalls.push(args)
        }
      }
    })

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: 1, ClientID: 100 },
        { SeatID: 2, ClientID: 200 }
      ],
      100
    )
    controller.setTrackerFirstHand(1)
    controller.setTrackerFirstHand(1)
    controller.setTrackerFirstHand(2)

    expect(controller.getTrackerRoom().firstID).toBe(1)
    expect(view.calls.scheduleRender).toBe(2)
    expect(seatReads).toEqual(['read'])
    expect(warnCalls).toEqual([
      [
        '先手座位重复设置且不一致，已忽略',
        {
          currentSeatID: 1,
          receivedSeatID: 2
        }
      ]
    ])
  })

  it('可直接同步协议移动，不加载浏览器 bridge', () => {
    const { controller, view } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([1, 2])
    controller.syncTrackerMove(protocolMove({ CardIDs: [1] }))

    const card = controller.getTrackerRoom().cardIndex.get(1)
    expect(card.location).toBe('player')
    expect(card.subZone).toBe('hand')
    expect(card.seats.has(1)).toBe(true)
    expect(view.calls.scheduleRender).toBe(2)
  })

  it('tracker 内部移动异常不会向桥接层外抛出', () => {
    const warnCalls = []
    const errorCalls = []
    const { controller } = createTrackerControllerHarness({
      logger: {
        warn(...args) {
          warnCalls.push(args)
        }
      },
      onError(...args) {
        errorCalls.push(args)
      }
    })

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([1])

    const room = controller.getTrackerRoom()
    vi.spyOn(room, 'moveCards').mockImplementation(() => {
      throw new Error('sync boom')
    })

    expect(() => controller.syncTrackerMove(protocolMove({ CardIDs: [1] }))).not.toThrow()

    expect(warnCalls.some(([label]) => label === '移动同步异常，已跳过本次 tracker 更新')).toBe(
      true
    )
    expect(errorCalls.some(([label]) => label === '[Refactor] 移动同步失败:')).toBe(true)
  })

  it('协议移动木马装备本体时同步装备归属', () => {
    const { controller } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: 4, ClientID: 400 },
        { SeatID: 5, ClientID: 500 }
      ],
      400
    )
    controller.initTrackerDeck([161])
    controller.syncTrackerMove(protocolMove({ CardIDs: [161], ToZone: 6, ToID: 4, SpellID: 700 }))
    controller.syncTrackerMove(
      protocolMove({ CardIDs: [161], FromZone: 6, FromID: 4, ToZone: 6, ToID: 5, MoveType: 15 })
    )

    const room = controller.getTrackerRoom()
    const muniu = room.cardIndex.get(161)

    expect(muniu.location).toBe('player')
    expect(muniu.subZone).toBe('equip')
    expect(muniu.seats.has(5)).toBe(true)
    expect(room.getPlayer(4).equipCards).toEqual([])
    expect(room.getPlayer(5).equipCards.map((card) => card.id)).toEqual([161])
  })

  it('主视角看到木马空间牌时收敛候选和暗牌', () => {
    const { controller } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 4, ClientID: 400 }], 400)
    controller.initTrackerDeck([152, 153])

    const room = controller.getTrackerRoom()
    const candidateCard = room.cardIndex.get(152)
    const hiddenCard = room.cardIndex.get(153)

    room.moveCards([152], 'player', {
      seatID: 4,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:known-hand' }
    })
    room.moveCards([0], 'player', {
      seatID: 4,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:unknown-hand' }
    })
    room.getPlayer(4).syncObservedHandCount(2)
    room.moveCards([0], 'player', {
      seatID: 4,
      fromSeatID: 4,
      fromZone: 5,
      fromSubZone: 'hand',
      subZone: 'mark',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:hidden-muniu-mark' }
    })

    expect(candidateCard.getLocationCandidates().length).toBe(2)
    expect(hiddenCard.isKnown).toBe(false)

    controller.revealTrackerCardsInZone(
      {
        id: 4,
        zone: 8,
        spellID: 700
      },
      [152, 153]
    )

    expect(room.getSkillState('hiddenMarkCandidates').records.has('4:4:700')).toBe(false)
    ;[candidateCard, hiddenCard].forEach((card) => {
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('mark')
      expect(card.spellID).toBe(700)
      expect(card.seats.has(4)).toBe(true)
      expect(card.isKnown).toBe(true)
      expect(card.getLocationCandidates()).toEqual([])
    })
  })

  it('手气卡将手牌放回牌堆时重置为未知牌', () => {
    const { controller } = createTrackerControllerHarness()
    const cardIDs = [7, 139, 76, 79]

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 3, ClientID: 100 }], 100)
    controller.initTrackerDeck([...cardIDs, 1])
    controller.syncTrackerMove(protocolMove({ CardIDs: cardIDs, ToID: 3 }))

    const room = controller.getTrackerRoom()
    cardIDs.forEach((id) => {
      const card = room.cardIndex.get(id)
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.isKnown).toBe(true)
    })

    controller.syncTrackerMove(returnToPileMove({ CardIDs: cardIDs, FromID: 3 }))

    const pileIDs = room.zones.get('pile').cards.map((card) => card.id)
    cardIDs.forEach((id) => {
      const card = room.cardIndex.get(id)
      expect(card.location).toBe('pile')
      expect(card.subZone).toBe(null)
      expect(card.isKnown).toBe(false)
      expect(card.seats.size).toBe(0)
      expect(pileIDs).toContain(id)
    })
  })

  it('问卦将已知手牌置于牌堆底时不扩散公共候选', () => {
    const { controller } = createTrackerControllerHarness()
    const handCardIDs = [2, 43, 130, 125, 146]

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([...handCardIDs, 1])
    controller.syncTrackerMove(protocolMove({ CardIDs: handCardIDs, ToID: 1 }))

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [146],
        CardCount: 1,
        FromID: 1,
        FromZone: 5,
        FromZoneParam: 0,
        FromPosition: 0,
        MoveType: 15,
        SpellID: 780,
        ToID: 255,
        ToZone: 1,
        ToZoneParam: 0,
        ToPosition: 0
      })
    )

    const room = controller.getTrackerRoom()
    const returnedCard = room.cardIndex.get(146)
    expect(returnedCard.location).toBe('pile')
    expect(returnedCard.publicCandidates).toEqual([])

    handCardIDs.slice(0, -1).forEach((id) => {
      const card = room.cardIndex.get(id)
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.publicCandidates).toEqual([])
    })
    expect(room.getPlayer(1).candidateHandCards).toEqual([])
  })

  it('从12区获得未登记的实体牌时补建真实手牌且不残留匿名实体', () => {
    const { controller } = createTrackerControllerHarness()
    const gainedCardIDs = [20410, 20420, 20411]

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 0, ClientID: 100 }], 100)
    controller.initTrackerDeck([1])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: gainedCardIDs,
        CardCount: 3,
        FromID: 255,
        FromZone: 12,
        FromZoneParam: 0,
        MoveType: 19,
        SpellID: 0,
        ToID: 0,
        ToZone: 5,
        ToZoneParam: 0
      })
    )

    const room = controller.getTrackerRoom()
    gainedCardIDs.forEach((cardID) => {
      const card = room.cardIndex.get(cardID)
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.seats.has(0)).toBe(true)
      expect(card.isKnown).toBe(true)
    })
    expect(
      room.cards.filter(
        (card) =>
          card.id === 0 &&
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(0)
      )
    ).toEqual([])
  })

  it('技能3571从牌堆揭示陈旧已知手牌时置换实体并保持牌堆数量', () => {
    const { controller } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 5, ClientID: 100 }], 100)
    controller.initTrackerDeck([1, 2, 3, 4, 34, 68, 161])
    controller.syncTrackerMove(protocolMove({ CardIDs: [161], ToID: 5 }))

    const skillMove = (cardID, fromZone, toZone, fromID = 255) =>
      protocolMove({
        CardIDs: [cardID],
        CardCount: 1,
        FromID: fromID,
        FromZone: fromZone,
        FromZoneParam: 0,
        MoveType: 6,
        SpellID: 3571,
        ToID: 255,
        ToZone: toZone,
        ToZoneParam: 0
      })

    controller.syncTrackerMove(skillMove(34, 1, 3))
    controller.syncTrackerMove(skillMove(34, 3, 8))
    controller.syncTrackerMove(skillMove(68, 1, 3))
    controller.syncTrackerMove(skillMove(68, 3, 8))

    const room = controller.getTrackerRoom()
    const pileCountBeforeLastReveal = room.zones.get('pile').cards.length

    controller.syncTrackerMove(skillMove(161, 1, 3, 5))

    const seatFiveHandCards = room.cards.filter(
      (card) =>
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(5) &&
        card.isKnown !== true
    )
    expect(room.cardIndex.get(161).location).toBe('process')
    expect(room.zones.get('pile').cards).toHaveLength(pileCountBeforeLastReveal - 1)
    expect(seatFiveHandCards).toHaveLength(1)
    expect(seatFiveHandCards[0].id).not.toBe(0)
  })

  it('技能304展示游戏外生成的匿名手牌时补建并揭示真实实体', () => {
    const { controller } = createTrackerControllerHarness()
    const knownHandIDs = [26, 149, 62]

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([...knownHandIDs, 1])
    controller.syncTrackerMove(protocolMove({ CardIDs: knownHandIDs, ToID: 1 }))
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromID: 255,
        FromZone: 12,
        MoveType: 19,
        ToID: 1,
        ToZone: 5
      })
    )

    const room = controller.getTrackerRoom()
    expect(
      room.cards.filter(
        (card) =>
          card.id === 0 &&
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(1)
      )
    ).toHaveLength(1)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [...knownHandIDs, 60992],
        CardCount: 4,
        FromID: 1,
        FromZone: 5,
        MoveType: 21,
        SpellID: 304,
        ToID: 1,
        ToZone: 5
      })
    )

    const revealedCard = room.cardIndex.get(60992)
    expect(revealedCard.location).toBe('player')
    expect(revealedCard.subZone).toBe('hand')
    expect(revealedCard.seats.has(1)).toBe(true)
    expect(revealedCard.isKnown).toBe(true)
    expect(
      room.cards.filter(
        (card) =>
          card.id === 0 &&
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(1)
      )
    ).toEqual([])
  })

  it('手气卡重摸明牌命中其他座位暗占位时保持牌堆与手牌数量', () => {
    const { controller } = createTrackerControllerHarness()
    const hiddenSeat = 2
    const mySeat = 3
    const originalIDs = [1, 2, 3, 4]
    const redrawnIDs = [12, 8, 7, 6]

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: hiddenSeat, ClientID: 200 },
        { SeatID: mySeat, ClientID: 100 }
      ],
      100
    )
    controller.initTrackerDeck([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

    // 先让牌堆顶的 12 成为其他座位暗占位，再在手气卡重摸时公开同一个 CardID。
    controller.syncTrackerMove(protocolMove({ CardIDs: [0, 0, 0, 0], ToID: hiddenSeat }))

    const room = controller.getTrackerRoom()
    const hiddenHandBefore = room.cards.filter(
      (card) =>
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(hiddenSeat) &&
        card.isKnown !== true
    )
    expect(hiddenHandBefore).toHaveLength(4)
    expect(room.cardIndex.get(12).seats.has(hiddenSeat)).toBe(true)

    controller.syncTrackerMove(protocolMove({ CardIDs: originalIDs, ToID: mySeat }))
    controller.syncTrackerMove(returnToPileMove({ CardIDs: originalIDs, FromID: mySeat }))

    const pileCountBeforeRedraw = room.zones.get('pile').cards.length

    controller.syncTrackerMove(protocolMove({ CardIDs: redrawnIDs, ToID: mySeat }))

    const hiddenHandAfter = room.cards.filter(
      (card) =>
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(hiddenSeat) &&
        card.isKnown !== true
    )
    expect(room.zones.get('pile').cards.length).toBe(pileCountBeforeRedraw - redrawnIDs.length)
    expect(hiddenHandAfter).toHaveLength(4)
    expect(hiddenHandAfter.map((card) => card.id)).not.toContain(12)
    redrawnIDs.forEach((id) => {
      const card = room.cardIndex.get(id)
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.seats.has(mySeat)).toBe(true)
      expect(card.isKnown).toBe(true)
    })
  })

  it('牌堆未初始化时不消费卡牌同步入口', () => {
    const { controller, view } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.syncTrackerMove(protocolMove({ CardIDs: [1] }))
    controller.revealTrackerCards({ type: 'player', seatID: 1 }, [1])

    const room = controller.getTrackerRoom()
    expect(controller.isTrackerReady()).toBe(false)
    expect(controller.getReadyTrackerRoom()).toBe(null)
    expect(room.cards).toEqual([])
    expect(view.calls.scheduleRender).toBe(1)
  })

  it('断线重连状态下跳过牌堆初始化并冻结牌堆相关同步', () => {
    const { controller, gameState, view } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    gameState.isDuanXian = true
    controller.initTrackerDeck([1, 2])

    expect(controller.isTrackerReady()).toBe(false)
    expect(controller.getTrackerRoom().isDeckReady).toBe(false)
    expect(view.calls.mount).toBe(1)
    expect(view.calls.unmount).toBe(1)

    gameState.isDuanXian = false
    controller.initTrackerDeck([1, 2])
    const room = controller.getTrackerRoom()
    const card = room.cardIndex.get(1)
    expect(controller.isTrackerReady()).toBe(true)
    expect(card.location).toBe('pile')

    gameState.isDuanXian = true
    controller.syncTrackerMove(protocolMove({ CardIDs: [1] }))

    expect(controller.getReadyTrackerRoom()).toBe(null)
    expect(card.location).toBe('pile')
  })
})
