import { describe, expect, it, vi } from 'vitest'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { HIDDEN_MARK_STATE_KEY, type HiddenMarkState } from '@/tracker/room/movement/types'
import { TrackerController } from '@/tracker/runtime/trackerController'
import {
  createErrorSpy,
  createTrackerControllerHarness,
  protocolMove,
  returnToPileMove,
  createReadyControllerHarness
} from './helpers/trackerController'
import { getCard as getCardFixture } from './helpers/room'

describe('TrackerController', () => {
  it('结构化协议揭示保留零号座位、零号标记和普通手牌的空技能号', () => {
    const { controller, room } = createReadyControllerHarness({
      players: [{ SeatID: 0, ClientID: 100 }],
      cardIDs: [1, 2]
    })

    controller.revealTrackerCardsInZone({ zone: 5, id: 0 }, [1])
    controller.revealTrackerCardsInZone({ zone: 4, id: 0, spellID: 0 }, [2])
    expect(room.cardIndex.get(1)).toMatchObject({
      location: 'player',
      owner: 0,
      subZone: 'hand',
      spellID: null,
      isKnown: true
    })
    expect(room.cardIndex.get(2)).toMatchObject({
      location: 'player',
      owner: 0,
      subZone: 'mark',
      spellID: 0,
      isKnown: true
    })
    controller.destroyTrackerRoom()
  })

  it('复制完整 patched 与 raw，冻结快照且不修改调用方消息', () => {
    const { controller, room } = createReadyControllerHarness({
      players: [{ SeatID: 0, ClientID: 100 }, { SeatID: 1 }],
      cardIDs: [1, 2, 3]
    })
    controller.setTrackerFirstHand(0)
    const decorateSpy = vi.spyOn(room, 'decorateMoveEvent')
    const raw = Object.freeze(protocolMove({ CardIDs: Object.freeze([1]), ToID: 1 }))
    const patched = Object.freeze({ ...raw, CardIDs: Object.freeze([2]) })

    controller.syncTrackerMove(patched, raw)

    expect(decorateSpy).toHaveBeenCalledOnce()
    const event = decorateSpy.mock.calls[0][0]
    expect(event.protocol).toEqual(patched)
    expect(event.protocol).not.toBe(patched)
    expect(event.cardIDs).not.toBe(patched.CardIDs)
    expect(event.raw).toEqual(raw)
    expect(event.raw).not.toBe(raw)
    expect(Object.isFrozen(event.raw)).toBe(true)
    expect(event.options.sourceEvent?.raw).toBe(event.raw)
    expect(controller.getTrackedPlayerHandCardIDs(1)).toEqual([2])
    expect(controller.getTrackedPlayerHandCardIDs(0)).toEqual([])
    expect(raw.CardIDs).toEqual([1])
    expect(patched.CardIDs).toEqual([2])
  })

  it.each([
    { zone: 6, subZone: 'equip' },
    { zone: 7, subZone: 'judge' },
    { zone: 4, subZone: 'mark' }
  ])('协议手牌来源与确定 $subZone 冲突时告警但不校正', ({ zone, subZone }) => {
    const warn = vi.fn()
    const { controller, room } = createReadyControllerHarness({
      ...{ logger: { warn } },
      players: [{ SeatID: 3, ClientID: 100 }],
      cardIDs: [1, 2, 3]
    })
    controller.revealTrackerCardsInZone({ zone: 5, id: 3 }, [2, 3])
    controller.revealTrackerCardsInZone({ zone, id: 3, spellID: 700 }, [1])
    const moveSpy = vi.spyOn(room, 'moveCards')
    warn.mockClear()
    const move = Object.freeze(protocolMove({ FromZone: 5, FromID: 3, ToZone: 2 }))

    controller.syncTrackerMove(move)

    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      '协议手牌来源与本地确定子区冲突，仍按协议处理',
      expect.objectContaining({
        cardID: 1,
        fromSeatID: 3,
        fromSubZone: 'hand',
        localSubZone: subZone
      })
    )
    expect(moveSpy).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({
        from: { type: 'player', seatID: 3, subZone: 'hand' },
        to: { type: 'public', zone: 'discard', position: 65280 }
      })
    )
    expect(room.cardIndex.get(1)?.location).toBe('discard')
    expect(move.FromZone).toBe(5)
  })

  it.each([false, true])('真实手牌来源有完整位置候选=%s 时不误告警或校正', (ambiguous) => {
    const warn = vi.fn()
    const { controller, room } = createReadyControllerHarness({
      ...{ logger: { warn } },
      players: [{ SeatID: 3, ClientID: 100 }],
      cardIDs: [1, 2]
    })
    controller.revealTrackerCardsInZone({ zone: ambiguous ? 4 : 5, id: 3, spellID: 700 }, [1])
    const card = room.cardIndex.get(1)!
    if (ambiguous) {
      card.setLocationCandidates([
        { type: 'player', seatID: 3, subZone: 'mark', spellID: 700 },
        { type: 'player', seatID: 3, subZone: 'hand' }
      ])
    }
    const moveSpy = vi.spyOn(room, 'moveCards')
    warn.mockClear()

    controller.syncTrackerMove(protocolMove({ FromZone: 5, FromID: 3, ToZone: 2 }))

    expect(warn).not.toHaveBeenCalled()
    expect(moveSpy).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({
        from: { type: 'player', seatID: 3, subZone: 'hand' },
        to: { type: 'public', zone: 'discard', position: 65280 }
      })
    )
    expect(card.location).toBe('discard')
  })

  it('临时隐藏和恢复座位保留手牌事实，重复状态不产生卡牌变更', () => {
    const { controller, room } = createReadyControllerHarness({
      players: [{ SeatID: 0, ClientID: 100 }, { SeatID: 1 }],
      cardIDs: [1, 2, 3]
    })
    controller.setTrackerFirstHand(0)
    controller.syncTrackerMove(protocolMove({ CardIDs: [1], ToID: 1 }))
    const player = room.getPlayer(1)!
    const card = room.cardIndex.get(1)!
    const dirtyCardSeq = room.dirtyCardSeq
    expect(player.observedHandCount).toBe(1)
    expect(controller.getTrackedPlayerHandCardIDs(1)).toEqual([1])

    controller.setTrackerPlayerShowStatuses([[1, 0]])
    expect(player.isShown).toBe(false)
    expect(player.observedHandCount).toBe(1)
    expect(controller.getTrackedPlayerHandCardIDs(1)).toEqual([1])
    expect(room.cardIndex.get(1)).toBe(card)

    room.viewDirty = false
    controller.setTrackerPlayerShowStatuses([[1, 0]])
    expect(room.viewDirty).toBe(false)
    controller.setTrackerPlayerShowStatuses([[1, 1]])
    expect(player.isShown).toBe(true)
    expect(room.viewDirty).toBe(true)
    expect(room.getPlayer(1)).toBe(player)
    expect(controller.getTrackedPlayerHandCardIDs(1)).toEqual([1])
    expect(room.dirtyCardSeq).toBe(dirtyCardSeq)
  })

  it.each([4, 5, 6, 7])('玩家区域 %s 的 255 座位展示不访问不存在的公共区', (zone) => {
    const { controller, room } = createReadyControllerHarness({
      players: [{ SeatID: 0, ClientID: 100 }],
      cardIDs: [1, 2]
    })
    const pileBefore = [...room.getZone('pile').cards]
    const errorSpy = createErrorSpy()

    try {
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [99],
          FromZone: zone,
          FromID: 255,
          ToZone: zone,
          ToID: 255,
          MoveType: 21
        })
      )

      expect(errorSpy).not.toHaveBeenCalled()
      expect(room.cardIndex.get(99)).toMatchObject({ location: 'outside', isKnown: true })
      expect(room.getZone('pile').cards).toEqual(pileBefore)
      expect(room.zones.has('player')).toBe(false)
      expect(room.assertPileIdentityLedgerConsistency('unregistered-public-show')).toEqual([])
    } finally {
      errorSpy.mockRestore()
      controller.destroyTrackerRoom()
    }
  })

  it.each([POSITION_TOP, POSITION_RANDOM])(
    'MoveType=18 匿名获得在来源位置 %s 跳过牌顶明牌，只消费暗槽',
    (fromPosition) => {
      const seatID = 1
      const { controller } = createReadyControllerHarness({
        players: [{ SeatID: seatID, ClientID: 100 }],
        cardIDs: [1, 2, 3, 4]
      })
      controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, [4])

      const room = controller.getTrackerRoom()
      const pile = room.zones.get('pile')
      expect(pile.cards.at(-1)?.id).toBe(4)
      expect(pile.cards.at(-1)?.isKnown).toBe(true)

      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [],
          CardCount: 1,
          FromPosition: fromPosition,
          MoveType: 18,
          SpellID: 9876,
          ToID: seatID
        })
      )

      expect(pile.cards).toHaveLength(3)
      expect(pile.cards.at(-1)?.id).toBe(4)
      expect(room.cardIndex.get(4).location).toBe('pile')
      const handCards = room.cards.filter(
        (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(seatID)
      )
      expect(handCards).toHaveLength(1)
      expect(handCards[0].isKnown).not.toBe(true)
    }
  )

  it('MoveType=1 常规摸牌按牌顶顺序取走明牌与后续暗槽', () => {
    const seatID = 1
    const { controller } = createReadyControllerHarness({
      players: [{ SeatID: seatID, ClientID: 100 }],
      cardIDs: [1, 2, 3, 4]
    })
    controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, [4])

    const room = controller.getTrackerRoom()
    const pile = room.zones.get('pile')
    expect(pile.cards.at(-1)).toMatchObject({ id: 4, isKnown: true })

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromPosition: POSITION_TOP,
        MoveType: 1,
        ToID: seatID
      })
    )

    expect(pile.cards).toHaveLength(2)
    expect(room.cardIndex.get(4)).toMatchObject({
      location: 'player',
      subZone: 'hand',
      isKnown: true
    })
    const handCards = room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(seatID)
    )
    expect(handCards).toHaveLength(2)
    expect(handCards.filter((card) => card.isKnown === true).map((card) => card.id)).toEqual([4])
  })

  it('观虚先展示牌顶再揭手牌时暗占位不盖住牌顶明牌', () => {
    const pileTopIDs = [62, 67, 37, 53, 142]
    const handIDs = [16, 160, 79, 106]
    const drawFillers = [200, 201, 202, 203]
    const deckIDs = [...handIDs, 142, 53, 37, 67, 62, ...drawFillers]
    const { controller } = createReadyControllerHarness({ seatIDs: [1, 3], cardIDs: deckIDs })

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
    const cardBelowKnownSegment = pile.cards.at(-(pileTopIDs.length + 1))
    expect(cardBelowKnownSegment).toBeDefined()
    expect(cardBelowKnownSegment?.isKnown).not.toBe(true)

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
          card.isAnonymous &&
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(1)
      )
    ).toHaveLength(0)
  })

  it('牌堆展示回收玩家区占用身份并保留匿名手牌占位', () => {
    const occupiedID = 67
    const pileTopIDs = [62, occupiedID, 37, 53, 142]
    const { controller } = createReadyControllerHarness({
      seatIDs: [1, 3],
      cardIDs: [200, 201, 142, 53, 37, occupiedID, 62]
    })

    const room = controller.getTrackerRoom()
    const pile = room.zones.get('pile')
    const occupiedCard = getCardFixture(room, occupiedID)!
    pile.removeCard(occupiedCard)
    occupiedCard.bindCandidates([3], 'hand', null, { known: false })
    occupiedCard.isKnown = false
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
    expect(
      room.cards.filter(
        (card) =>
          card.isAnonymous &&
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(3)
      )
    ).toHaveLength(1)
    expect(room.getPlayer(3).unknownCardCount).toBe(1)
  })

  it('牌底展示回收玩家区占用身份时从底侧选择占位并保持牌顶顺序', () => {
    const occupiedID = 10
    const { controller, room } = createReadyControllerHarness({
      seatIDs: [1, 3],
      cardIDs: [occupiedID, 11, 12, 13, 14, 15]
    })
    const pile = room.zones.get('pile')!
    const occupiedCard = room.materialize(occupiedID, pile.cards[0])!
    const topKnownCards = [
      room.materialize(14, pile.cards.at(-2)!)!,
      room.materialize(15, pile.cards.at(-1)!)!
    ]

    pile.removeCard(occupiedCard)
    occupiedCard.bindCandidates([3], 'hand', null, { known: false })
    occupiedCard.isKnown = false
    room.getPlayer(3).syncObservedHandCount(1)
    room.resolveConstraints()
    const bottomPlaceholder = pile.cards[0]

    controller.revealTrackerCardsInZone({ id: 255, zone: 1, pos: POSITION_BOTTOM }, [occupiedID])

    expect(pile.cards).toHaveLength(5)
    expect(pile.cards[0]?.id).toBe(occupiedID)
    expect(bottomPlaceholder.location).toBe('player')
    expect(bottomPlaceholder.isAnonymous).toBe(true)
    expect(bottomPlaceholder.seats).toEqual(new Set([3]))
    expect(topKnownCards.map((card) => card.location)).toEqual(['pile', 'pile'])
    expect(topKnownCards.every((card) => card.isKnown)).toBe(true)
  })

  it('牌堆展示不会抽走仍属于玩家区且未声明为牌顶的实体', () => {
    const handID = 16
    const pileIDs = [62, 67, 37, 53, 142]
    const { controller } = createReadyControllerHarness({
      seatIDs: [1, 3],
      cardIDs: [...pileIDs, handID, 200]
    })

    const room = controller.getTrackerRoom()
    const handCard = getCardFixture(room, handID)!
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
          card.isAnonymous &&
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

  it.each([0, 7])('明确视角可覆盖兜底推断为座位 %s，后续兜底不改写', (seatID) => {
    const { controller, gameState } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: 0, ClientID: 100 },
        { SeatID: 7, ClientID: 107 }
      ],
      999
    )
    const previousSeatID = seatID === 0 ? 7 : 0
    controller.setTrackerMySeatID(previousSeatID)
    const room = controller.getTrackerRoom()!

    controller.setTrackerMySeatID(seatID, { overwrite: true })
    controller.setTrackerMySeatID(previousSeatID)

    expect(controller.getTrackerRoom()).toBe(room)
    expect(room.mySeatID).toBe(seatID)
    expect(gameState.myID).toBe(seatID)
    expect(gameState.isRecord).toBe(true)
    expect(room.isDeckReady).toBe(false)
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
    const { controller, view } = createReadyControllerHarness({ seatIDs: [1], cardIDs: [1, 2] })
    controller.syncTrackerMove(protocolMove({ CardIDs: [1] }))

    const card = controller.getTrackerRoom().cardIndex.get(1)
    expect(card.location).toBe('player')
    expect(card.subZone).toBe('hand')
    expect(card.seats.has(1)).toBe(true)
    expect(view.calls.scheduleRender).toBe(2)
  })

  it('tracker 内部移动异常不会向桥接层外抛出', () => {
    const errorSpy = createErrorSpy()
    const { controller } = createReadyControllerHarness({ seatIDs: [1], cardIDs: [1] })

    const room = controller.getTrackerRoom()
    vi.spyOn(room, 'moveCards').mockImplementation(() => {
      throw new Error('sync boom')
    })

    expect(() => controller.syncTrackerMove(protocolMove({ CardIDs: [1] }))).not.toThrow()

    expect(errorSpy).toHaveBeenCalledWith(
      '移动同步异常，已跳过本次 tracker 更新',
      expect.objectContaining({ message: 'sync boom' }),
      expect.anything()
    )
  })

  it('协议移动木马装备本体时同步装备归属', () => {
    const { controller } = createReadyControllerHarness({
      seatIDs: [4, 5],
      currentUserID: 400,
      cardIDs: [161]
    })
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
    const { controller } = createReadyControllerHarness({
      seatIDs: [4],
      currentUserID: 400,
      cardIDs: [152, 153]
    })

    const room = controller.getTrackerRoom()
    const candidateCard = getCardFixture(room, 152)!
    const hiddenCard = getCardFixture(room, 153)!
    hiddenCard.isKnown = false

    room.moveCards([152], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 4, subZone: 'hand' },
      cardCount: 1,
      sourceEvent: { type: 'test:known-hand' }
    })
    room.moveCards([0], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 4, subZone: 'hand' },
      cardCount: 1,
      sourceEvent: { type: 'test:unknown-hand' }
    })
    room.getPlayer(4).syncObservedHandCount(2)
    room.moveCards([0], {
      from: { type: 'player', seatID: 4, subZone: 'hand' },
      to: { type: 'player', seatID: 4, subZone: 'mark', markSpellID: 700 },
      triggerSpellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:hidden-muniu-mark' }
    })

    expect(candidateCard.locationCandidates.length).toBe(2)
    expect(hiddenCard.isKnown).toBe(false)

    controller.revealTrackerCardsInZone(
      {
        id: 4,
        zone: 4,
        spellID: 700
      },
      [152, 153]
    )

    expect(
      room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)?.records.has('4:muniu:161') ??
        false
    ).toBe(false)
    ;[candidateCard, hiddenCard].forEach((card) => {
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('mark')
      expect(card.spellID).toBe(700)
      expect(card.seats.has(4)).toBe(true)
      expect(card.isKnown).toBe(true)
      expect(card.locationCandidates).toEqual([])
    })
  })

  it('手气卡将手牌放回牌堆时重置为未知牌', () => {
    const cardIDs = [7, 139, 76, 79]
    const { controller } = createReadyControllerHarness({
      players: [{ SeatID: 3, ClientID: 100 }],
      cardIDs: [...cardIDs, 1]
    })
    controller.syncTrackerMove(protocolMove({ CardIDs: cardIDs, ToID: 3 }))

    const room = controller.getTrackerRoom()
    cardIDs.forEach((id) => {
      const card = room.cardIndex.get(id)
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.isKnown).toBe(true)
    })

    controller.syncTrackerMove(returnToPileMove({ CardIDs: cardIDs, FromID: 3 }))

    const pileCards = room.zones.get('pile').cards
    expect(pileCards).toHaveLength(cardIDs.length + 1)
    expect(pileCards.every((card) => card.id < 0 && card.entityID < 0)).toBe(true)
    expect(pileCards.every((card) => card.isKnown !== true)).toBe(true)
    expect(room.pileIdentityLedger.getSnapshot().cohort.groups).toEqual([
      {
        generation: 0,
        kind: 'all-in-pile',
        cardIDs: [1, 7, 76, 79, 139],
        remainingPileCount: 5
      }
    ])
    cardIDs.forEach((id) => {
      expect(room.cardIndex.has(id)).toBe(false)
      expect(room.unlocatedIdentities.has(id)).toBe(true)
      expect(room.deckIdentities.has(id)).toBe(true)
    })
  })

  it('游戏外匿名牌先进入12区后按实体牌揭示到装备区', () => {
    const { controller } = createReadyControllerHarness({
      players: [{ SeatID: 5, ClientID: 100 }],
      cardIDs: [1]
    })
    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [],
        FromID: 255,
        FromPosition: POSITION_TOP,
        FromZone: 0,
        FromZoneParam: 0,
        MoveType: 19,
        SpellID: 11003,
        ToID: 255,
        ToPosition: POSITION_TOP,
        ToZone: 12,
        ToZoneParam: 0
      })
    )

    const room = controller.getTrackerRoom()
    const [placeholder] = room.zones.get('exile')!.cards
    expect(placeholder).toBeDefined()
    expect(placeholder.isAnonymous).toBe(true)

    controller.syncTrackerMove(
      protocolMove({
        CardCount: 1,
        CardIDs: [12126],
        FromID: 255,
        FromPosition: POSITION_RANDOM,
        FromZone: 12,
        FromZoneParam: 0,
        MoveType: 15,
        SpellID: 11003,
        ToID: 5,
        ToPosition: POSITION_RANDOM,
        ToZone: 6,
        ToZoneParam: 0
      })
    )

    const revealedCard = room.cardIndex.get(12126)
    expect(revealedCard).toBe(placeholder)
    expect(revealedCard.location).toBe('player')
    expect(revealedCard.subZone).toBe('equip')
    expect(revealedCard.seats.has(5)).toBe(true)
    expect(revealedCard.isKnown).toBe(true)
    expect(room.zones.get('exile')!.cards).toEqual([])
    expect(room.cards).toHaveLength(2)
  })

  it('从12区获得未登记的实体牌时补建真实手牌且不残留匿名实体', () => {
    const gainedCardIDs = [20410, 20420, 20411]
    const { controller } = createReadyControllerHarness({
      players: [{ SeatID: 0, ClientID: 100 }],
      cardIDs: [1]
    })
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
          card.isAnonymous &&
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(0)
      )
    ).toEqual([])
  })

  it('从12区获得60461并洗入弃牌后连续明摸保持牌堆张数', () => {
    const { controller } = createReadyControllerHarness({
      players: [{ SeatID: 0, ClientID: 100 }],
      cardIDs: [1, 2, 3, 4, 5, 6]
    })
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [60461],
        CardCount: 1,
        FromID: 255,
        FromZone: 12,
        MoveType: 19,
        ToID: 0,
        ToZone: 5
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [60461],
        CardCount: 1,
        FromID: 0,
        FromZone: 5,
        MoveType: 4,
        ToID: 255,
        ToZone: 2
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromID: 255,
        FromZone: 1,
        MoveType: 1,
        ToID: 0,
        ToZone: 5
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [1, 2, 3],
        CardCount: 3,
        FromID: 255,
        FromZone: 1,
        MoveType: 4,
        ToID: 255,
        ToZone: 2
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 5,
        FromID: 255,
        FromZone: 2,
        MoveType: 255,
        ToID: 255,
        ToZone: 9
      })
    )

    controller.syncTrackerMove(protocolMove({ CardIDs: [4], CardCount: 1, ToID: 0 }))
    controller.syncTrackerMove(protocolMove({ CardIDs: [5], CardCount: 1, ToID: 0 }))

    const room = controller.getTrackerRoom()
    const expectedIdentityIDs = new Set([1, 2, 3, 4, 5, 6, 60461])
    const locatedIdentityIDs = new Set(room.cardIndex.keys())
    expect(room.zones.get('pile').cards).toHaveLength(3)
    expect(room.deckIdentities).toEqual(expectedIdentityIDs)
    expect(
      [...locatedIdentityIDs].filter((cardID) => room.unlocatedIdentities.has(cardID))
    ).toEqual([])
    expect(new Set([...locatedIdentityIDs, ...room.unlocatedIdentities])).toEqual(
      expectedIdentityIDs
    )
  })

  it('手气卡回牌堆真正匿名化后，后续暗摸不会得到正ID暗手', () => {
    const knownIDs = [7, 139]
    const seatID = 1
    const { controller } = createReadyControllerHarness({
      players: [{ SeatID: seatID, ClientID: 100 }],
      cardIDs: [...knownIDs, 1, 2, 3, 4]
    })
    controller.syncTrackerMove(protocolMove({ CardIDs: knownIDs, ToID: seatID }))
    controller.syncTrackerMove(returnToPileMove({ CardIDs: knownIDs, FromID: seatID }))

    const room = controller.getTrackerRoom()
    expect(room.zones.get('pile').cards.every((card) => card.id < 0)).toBe(true)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        ToID: seatID
      })
    )

    const handCards = room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(seatID)
    )
    expect(handCards).toHaveLength(2)
    expect(handCards.every((card) => card.id < 0 && card.isKnown !== true)).toBe(true)
    knownIDs.forEach((id) => {
      expect(room.unlocatedIdentities.has(id)).toBe(true)
      expect(room.cardIndex.has(id)).toBe(false)
    })
  })
  it('手气卡重摸明牌命中其他座位暗占位时保持牌堆与手牌数量', () => {
    const hiddenSeat = 2
    const mySeat = 3
    const originalIDs = [1, 2, 3, 4]
    const redrawnIDs = [12, 8, 7, 6]
    const { controller } = createReadyControllerHarness({
      players: [
        { SeatID: hiddenSeat, ClientID: 200 },
        { SeatID: mySeat, ClientID: 100 }
      ],
      cardIDs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    })

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
    expect(room.unlocatedIdentities.has(12)).toBe(true)

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

  it('随机获得后使用自身暗牌不应绑定匿名实体身份', () => {
    const knownIDs = [77, 116, 89, 159, 61, 134]
    const lowerFillerIDs = Array.from({ length: 13 }, (_, index) => 201 + index)
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
    const { controller } = createReadyControllerHarness({ seatIDs: [1, 2], cardIDs: deckIDs })

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
    const card134 = room.cardIndex.get(134)
    expect(card134?.location).toBe('process')
    expect(card134?.isKnown).toBe(true)
    expect(
      room.cards
        .filter(
          (card) =>
            card.isAnonymous &&
            card.location === 'player' &&
            card.subZone === 'hand' &&
            card.seats.has(2)
        )
        .every((card) => card.id < 0)
    ).toBe(true)
  })

  it('重连通知先于牌堆初始化时仍挂载并继续同步，牌堆数量等待协议锚定', () => {
    const { controller, view } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.degradeTrackerRoom()
    controller.initTrackerDeck([1, 2])

    const room = controller.getTrackerRoom()
    expect(controller.isTrackerReady()).toBe(true)
    expect(room.trackingMode).toBe('degraded')
    expect(room.isPileCountKnown).toBe(false)
    expect(view.calls.mount).toBe(2)
    expect(view.calls.unmount).toBe(0)
    expect(room.cardIndex.has(1)).toBe(false)
    expect(room.unlocatedIdentities.has(1)).toBe(true)

    controller.syncTrackerMove(protocolMove({ CardIDs: [1] }))

    expect(controller.getReadyTrackerRoom()).toBe(room)
    expect(room.cardIndex.get(1)?.resolvedSeat).toBe(1)
    expect(room.zones.get('pile').cards).toHaveLength(1)
  })

  it.each([
    { source: '判定区', FromZone: 7, FromID: 0 },
    { source: '弹窗', FromZone: 8, FromID: 35 }
  ])('$source 明示到公共区时按协议来源位置物化，目标位置不覆盖来源牌序', ({ FromZone, FromID }) => {
    const { controller, room } = createReadyControllerHarness({
      players: [{ SeatID: 0, ClientID: 100 }],
      cardIDs: [1, 2, 3]
    })
    room.moveCards([], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'public', zone: 'process', position: POSITION_TOP },
      cardCount: 3
    })
    const slots = [...room.getZone('process').cards]

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [1, 2],
        FromZone,
        FromID,
        FromPosition: POSITION_BOTTOM,
        ToZone: 3,
        ToID: 255,
        ToPosition: POSITION_TOP,
        MoveType: 6
      })
    )

    expect(room.cardIndex.get(1)).toBe(slots[0])
    expect(room.cardIndex.get(2)).toBe(slots[1])
    expect(slots[2].isAnonymous).toBe(true)
    expect(room.getZone('process').cards).toEqual(slots)
    expect(room.cards).toHaveLength(3)
    expect(room.assertPileIdentityLedgerConsistency('test:show-source-position')).toEqual([])
    controller.destroyTrackerRoom()
  })

  it('揭示身份无匿名槽可物化时告警并从已知牌集合略过', () => {
    const warn = vi.fn()
    const { controller, room } = createReadyControllerHarness({
      ...{ logger: { warn } },
      seatIDs: [1],
      cardIDs: [1, 2, 3]
    })
    // 清空牌堆后，牌堆端点没有匿名槽可承接揭示身份 1，它仍停留在 unlocatedIdentities。
    room.zones.get('pile')!.clear()

    controller.revealTrackerCardsInZone({ id: 255, zone: 1, pos: POSITION_BOTTOM }, [1])

    expect(room.cardIndex.has(1)).toBe(false)
    expect(room.unlocatedIdentities.has(1)).toBe(true)
    const warning = warn.mock.calls.find(
      ([, meta]) =>
        (meta as { reason?: string } | undefined)?.reason ===
        'resolveKnownCards:unresolvedUnlocatedIdentity'
    )
    expect(warning).toBeDefined()
    expect((warning?.[1] as { unresolvedIdentityIDs: number[] }).unresolvedIdentityIDs).toContain(1)
  })
  it.each([
    {
      scenario: '牌顶揭示',
      revealedIDs: [158, 2, 63, 125],
      deckIDs: [158, 2, 63, 125, 200, 201],
      position: POSITION_TOP,
      protocol: false,
      reposition: false
    },
    // 嚣翻 Datas 第一项为牌底最外层，handler reverse 后传入牌底位置。
    {
      scenario: '嚣翻牌底揭示',
      revealedIDs: [1, 123, 149],
      deckIDs: [200, 201, 202, 149, 123, 1],
      position: POSITION_BOTTOM,
      protocol: false,
      reposition: true
    },
    {
      scenario: '观虚同区展示',
      revealedIDs: [62, 67, 37, 53, 142],
      deckIDs: [200, 201, 62, 67, 37, 53, 142, 202, 203],
      position: POSITION_TOP,
      protocol: true,
      reposition: false
    }
  ])(
    '$scenario 按协议定位明牌且重复消息保持幂等',
    ({ revealedIDs, deckIDs, position, protocol, reposition }) => {
      const { controller, room } = createReadyControllerHarness({ cardIDs: deckIDs })
      const pile = room.zones.get('pile')!
      const addSpy = vi.spyOn(pile, 'add')
      const reveal = () => {
        if (protocol) {
          controller.syncTrackerMove(
            protocolMove({
              CardIDs: revealedIDs,
              FromID: 255,
              FromZone: 1,
              ToID: 255,
              ToZone: 1,
              MoveType: 21,
              SpellID: 987
            })
          )
          return
        }
        controller.revealTrackerCardsInZone(
          position === POSITION_BOTTOM
            ? { id: 255, zone: 1, pos: POSITION_BOTTOM }
            : { id: 255, zone: 1 },
          revealedIDs
        )
      }
      const displayedIDs = () =>
        (position === POSITION_BOTTOM
          ? pile.cards.slice(0, revealedIDs.length)
          : pile.cards.slice(-revealedIDs.length)
        ).map((card) => card.id)
      const expectedIDs = [...revealedIDs].reverse()
      reveal()
      expect(displayedIDs()).toEqual(expectedIDs)
      expect((position === POSITION_BOTTOM ? pile.cards[0] : pile.cards.at(-1))?.id).toBe(
        position === POSITION_BOTTOM ? expectedIDs[0] : revealedIDs[0]
      )
      revealedIDs.forEach((id) => expect(room.cardIndex.get(id)!.isKnown).toBe(true))
      if (reposition) expect(addSpy).toHaveBeenCalledOnce()
      else expect(addSpy).not.toHaveBeenCalled()
      const dirtyCardSeq = room.dirtyCardSeq
      addSpy.mockClear()
      reveal()
      expect(addSpy).not.toHaveBeenCalled()
      expect(room.dirtyCardSeq).toBe(dirtyCardSeq)
      expect(displayedIDs()).toEqual(expectedIDs)
    }
  )
})
