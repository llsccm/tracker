import { describe, expect, it, vi } from 'vitest'
import { TrackerController } from '@/tracker/runtime/trackerController'
import {
  createTrackerControllerHarness,
  protocolMove,
  returnToPileMove
} from './helpers/trackerController'

describe('TrackerController', () => {
  it('牌堆明牌同步将已有卡牌定位到牌顶且重复消息保持幂等', () => {
    const { controller } = createTrackerControllerHarness()
    const revealedIDs = [158, 2, 63, 125]

    controller.initTrackerRoom()
    controller.initTrackerDeck([...revealedIDs, 200, 201])

    const room = controller.getTrackerRoom()
    const pile = room.zones.get('pile')
    const addSpy = vi.spyOn(pile, 'add')

    controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, revealedIDs)

    expect(pile.cards.slice(-revealedIDs.length).map((card) => card.id)).toEqual([125, 63, 2, 158])
    expect(pile.cards.at(-1)?.id).toBe(158)
    revealedIDs.forEach((id) => expect(room.cardIndex.get(id).isKnown).toBe(true))
    expect(addSpy).toHaveBeenCalledOnce()

    const dirtyCardSeq = room.dirtyCardSeq
    addSpy.mockClear()
    controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, revealedIDs)

    expect(addSpy).not.toHaveBeenCalled()
    expect(room.dirtyCardSeq).toBe(dirtyCardSeq)
  })

  it('观虚同区展示将牌堆顶重排到协议顺序且重复消息保持幂等', () => {
    const { controller } = createTrackerControllerHarness()
    const revealedIDs = [62, 67, 37, 53, 142]
    const deckIDs = [200, 201, ...revealedIDs, 202, 203]

    controller.initTrackerRoom()
    controller.initTrackerDeck(deckIDs)

    const room = controller.getTrackerRoom()
    const pile = room.zones.get('pile')
    const addSpy = vi.spyOn(pile, 'add')

    controller.syncTrackerMove(
      protocolMove({
        CardCount: revealedIDs.length,
        CardIDs: revealedIDs,
        FromID: 255,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 21,
        SpellID: 987,
        ToID: 255,
        ToZone: 1,
        ToZoneParam: 0
      })
    )

    expect(pile.cards.slice(-revealedIDs.length).map((card) => card.id)).toEqual([
      142, 53, 37, 67, 62
    ])
    expect(pile.cards.at(-1)?.id).toBe(62)
    revealedIDs.forEach((id) => expect(room.cardIndex.get(id).isKnown).toBe(true))
    expect(addSpy).toHaveBeenCalledOnce()

    const dirtyCardSeq = room.dirtyCardSeq
    addSpy.mockClear()
    controller.syncTrackerMove(
      protocolMove({
        CardCount: revealedIDs.length,
        CardIDs: revealedIDs,
        FromID: 255,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 21,
        SpellID: 987,
        ToID: 255,
        ToZone: 1,
        ToZoneParam: 0
      })
    )

    expect(addSpy).not.toHaveBeenCalled()
    expect(room.dirtyCardSeq).toBe(dirtyCardSeq)
    expect(pile.cards.slice(-revealedIDs.length).map((card) => card.id)).toEqual([
      142, 53, 37, 67, 62
    ])
  })

  it('观虚先展示牌顶再揭手牌时暗占位不盖住牌顶明牌', () => {
    const { controller } = createTrackerControllerHarness()
    const pileTopIDs = [62, 67, 37, 53, 142]
    const handIDs = [16, 160, 79, 106]
    // 底部先放稍后揭开的手牌身份，顶部 4 张暗摸只拿走无关实体。
    // 内部顺序底->顶：handIDs + pileTop(顶=62) + drawFillers(顶)。
    const drawFillers = [200, 201, 202, 203]
    const deckIDs = [...handIDs, 142, 53, 37, 67, 62, ...drawFillers]

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: 1, ClientID: 100 },
        { SeatID: 3, ClientID: 300 }
      ],
      100
    )
    controller.initTrackerDeck(deckIDs)

    const room = controller.getTrackerRoom()
    const pile = room.zones.get('pile')

    // seat1 先摸 4 张无关暗牌；真实手牌身份 16/160/79/106 仍留在牌堆。
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [0, 0, 0, 0],
        CardCount: 4,
        ToID: 1
      })
    )
    room.getPlayer(1).syncObservedHandCount(4)

    controller.syncTrackerMove(
      protocolMove({
        CardCount: pileTopIDs.length,
        CardIDs: pileTopIDs,
        FromID: 255,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 21,
        SpellID: 987,
        ToID: 255,
        ToZone: 1,
        ToZoneParam: 0
      })
    )

    controller.revealTrackerCards({ type: 'player', seatID: 1 }, handIDs)

    expect(pile.cards.slice(-pileTopIDs.length).map((card) => card.id)).toEqual([
      142, 53, 37, 67, 62
    ])
    expect(pile.cards.slice(-pileTopIDs.length).every((card) => card.isKnown)).toBe(true)
    // 被置换回牌堆的暗占位必须落在明牌段下方，不能盖住牌顶。
    expect(pile.cards.at(-(pileTopIDs.length + 1))?.isKnown).not.toBe(true)

    handIDs.forEach((id) => {
      const card = room.cardIndex.get(id)
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.seats.has(1)).toBe(true)
      expect(card.isKnown).toBe(true)
    })

    expect(
      room.cards.filter(
        (card) =>
          card.id === 0 &&
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(1)
      )
    ).toHaveLength(0)
  })

  it('牌堆展示回收玩家区占用身份并保留匿名手牌占位', () => {
    const { controller } = createTrackerControllerHarness()
    // 67 被 seat3 暗手牌实体占用，协议却声明它是牌堆顶之一。
    const occupiedID = 67
    const pileTopIDs = [62, occupiedID, 37, 53, 142]

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: 1, ClientID: 100 },
        { SeatID: 3, ClientID: 300 }
      ],
      100
    )
    // 内部底->顶：filler + pileTop(顶=62)
    controller.initTrackerDeck([200, 201, 142, 53, 37, occupiedID, 62])

    const room = controller.getTrackerRoom()
    const pile = room.zones.get('pile')
    const occupiedCard = room.cardIndex.get(occupiedID)
    const fillerA = room.cardIndex.get(200)
    const fillerB = room.cardIndex.get(201)
    pile.removeCard(occupiedCard)
    occupiedCard.bindCandidates([3], 'hand', null, { known: false })
    room.getPlayer(3).syncObservedHandCount(1)
    room.resolveConstraints()

    const pileCountBefore = pile.cards.length
    expect(occupiedCard.location).toBe('player')
    expect(occupiedCard.seats.has(3)).toBe(true)

    controller.syncTrackerMove(
      protocolMove({
        CardCount: pileTopIDs.length,
        CardIDs: pileTopIDs,
        FromID: 255,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 21,
        SpellID: 987,
        ToID: 255,
        ToZone: 1,
        ToZoneParam: 0
      })
    )

    expect(pile.cards).toHaveLength(pileCountBefore)
    expect(pile.cards.slice(-pileTopIDs.length).map((card) => card.id)).toEqual([
      142, 53, 37, 67, 62
    ])
    expect(occupiedCard.location).toBe('pile')
    expect(occupiedCard.isKnown).toBe(true)
    // 用牌堆未知实体换回玩家槽位，不新增 id=0 导致 5+123。
    expect(fillerA.location === 'player' || fillerB.location === 'player').toBe(true)
    expect(
      room.cards.filter(
        (card) =>
          card.id === 0 &&
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(3)
      )
    ).toHaveLength(0)
    expect(room.getPlayer(3).unknownCardCount).toBe(1)
  })

  it('牌堆展示不会抽走仍属于玩家区且未声明为牌顶的实体', () => {
    const { controller } = createTrackerControllerHarness()
    const handID = 16
    const pileIDs = [62, 67, 37, 53, 142]

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: 1, ClientID: 100 },
        { SeatID: 3, ClientID: 300 }
      ],
      100
    )
    controller.initTrackerDeck([...pileIDs, handID, 200])

    const room = controller.getTrackerRoom()
    const handCard = room.cardIndex.get(handID)
    room.zones.get('pile').removeCard(handCard)
    handCard.bindCandidates([3], 'hand', null, { known: true })
    room.getPlayer(3).syncObservedHandCount(1)
    room.resolveConstraints()

    controller.syncTrackerMove(
      protocolMove({
        CardCount: pileIDs.length,
        CardIDs: pileIDs,
        FromID: 255,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 21,
        SpellID: 987,
        ToID: 255,
        ToZone: 1,
        ToZoneParam: 0
      })
    )

    expect(handCard.location).toBe('player')
    expect(handCard.subZone).toBe('hand')
    expect(handCard.seats.has(3)).toBe(true)
    expect(room.zones.get('pile').cards.map((card) => card.id)).not.toContain(handID)
    expect(
      room.cards.filter(
        (card) =>
          card.id === 0 &&
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(3)
      )
    ).toHaveLength(0)
  })

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

  it('随机获得后使用自身暗牌不应按实体顺序排除候选明牌', () => {
    const { controller } = createTrackerControllerHarness()
    const knownIDs = [77, 116, 89, 159, 61, 134]
    const lowerFillerIDs = Array.from({ length: 13 }, (_, index) => 201 + index)
    // 牌堆顶部先发 217-220 给 1 号位，再把 134/214/215 作为 2 号位的三张暗实体。
    // 后续 1 号位使用 134 时，不能因为内部暗实体 ID 碰巧命中就确认它来自随机转移。
    const deckIDs = [
      ...knownIDs.filter((id) => id !== 134),
      ...lowerFillerIDs,
      134,
      214,
      215,
      217,
      218,
      219,
      220
    ]

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: 1, ClientID: 100 },
        { SeatID: 2, ClientID: 200 }
      ],
      100
    )
    controller.initTrackerDeck(deckIDs)

    const syncMove = (overrides: Parameters<typeof protocolMove>[0]) =>
      controller.syncTrackerMove(protocolMove(overrides))

    // 初始暗手牌：先发 1 号位 4 张，再发 2 号位 3 张。
    syncMove({ CardIDs: [], CardCount: 4, ToID: 1 })
    syncMove({ CardIDs: [], CardCount: 3, ToID: 2 })

    syncMove({
      CardIDs: [77],
      CardCount: 1,
      FromID: 0,
      FromZone: 5,
      MoveType: 27,
      SpellID: 31,
      ToID: 1,
      ToZone: 5
    })
    syncMove({
      CardIDs: [116],
      CardCount: 1,
      FromID: 0,
      FromZone: 5,
      MoveType: 27,
      SpellID: 31,
      ToID: 2,
      ToZone: 5
    })
    syncMove({ CardIDs: [], CardCount: 2, ToID: 1 })
    syncMove({ CardIDs: [89], CardCount: 1, FromID: 1, FromZone: 5, ToZone: 3, MoveType: 2 })
    syncMove({
      CardIDs: [],
      CardCount: 1,
      FromID: 2,
      FromZone: 5,
      MoveType: 18,
      SpellID: 4,
      ToID: 1,
      ToZone: 5
    })
    syncMove({
      CardIDs: [159],
      CardCount: 1,
      FromID: 1,
      FromZone: 5,
      ToZone: 2,
      MoveType: 12
    })
    syncMove({ CardIDs: [], CardCount: 1, ToID: 1 })
    syncMove({ CardIDs: [61], CardCount: 1, FromID: 1, FromZone: 5, ToZone: 3, MoveType: 2 })
    syncMove({
      CardIDs: [134],
      CardCount: 1,
      FromID: 1,
      FromZone: 5,
      ToZone: 3,
      MoveType: 2
    })

    const room = controller.getTrackerRoom()
    const card116 = room.cardIndex.get(116)
    const transferGroup = Array.from(room.constraintGroups.values()).find(
      (group) =>
        group.cards.has(card116) &&
        group.expectedSlotsBySeat.has(1) &&
        group.expectedSlotsBySeat.has(2)
    )
    expect(transferGroup?.expectedSlotsBySeat.get(1)).toBe(1)
    expect(transferGroup?.expectedSlotsBySeat.get(2)).toBe(3)
    expect(Array.from(card116.seats).sort()).toEqual([1, 2])
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
