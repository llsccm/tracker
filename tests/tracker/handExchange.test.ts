import { describe, expect, it } from 'vitest'
import { HAND_EXCHANGE_STATE_KEY } from '@/tracker/skill/HandExchange'
import type { Room } from '@/tracker/Room'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

describe('整手牌经交换区互易（通用协议模式）', () => {
  const seatA = 4
  const seatB = 5
  const knownFromB = [106, 14, 68, 67]
  const hiddenFromA = [201, 202, 203, 204]
  const hiddenFromB = [301, 302, 303, 304]
  const hiddenFromC = [401, 402, 403]
  const allIDs = [...knownFromB, ...hiddenFromA, ...hiddenFromB, ...hiddenFromC]

  function getCard(room: Room, id: number) {
    return room.cardIndex.get(id)!
  }

  function handCards(room: Room, seatID: number) {
    return room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(seatID)
    )
  }

  function handIDs(room: Room, seatID: number): number[] {
    return handCards(room, seatID)
      .map((card) => card.id)
      .sort((a, b) => a - b)
  }

  function bindHiddenHand(room: Room, ids: number[], seatID: number) {
    const cards = ids.map((id) => getCard(room, id))
    room.clearCardsFromPublicZones(cards)
    cards.forEach((card) => {
      card.bindCandidates([seatID], 'hand', null, { known: false })
      card.isKnown = false
      room.notifyCardChanged(card, { type: 'test:hidden-hand' })
    })
  }

  function setupController() {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: seatA, ClientID: 400 },
        { SeatID: seatB, ClientID: 500 },
        { SeatID: 3, ClientID: 300 }
      ],
      400
    )
    controller.initTrackerDeck(allIDs)

    const room = controller.getTrackerRoom()!

    bindHiddenHand(room, hiddenFromA, seatA)
    room.getPlayer(seatA).syncObservedHandCount(4)

    bindHiddenHand(room, hiddenFromB, seatB)
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: knownFromB,
        CardCount: 4,
        FromZone: 1,
        FromID: 255,
        ToZone: 5,
        ToID: seatB,
        MoveType: 1,
        SpellID: 0
      })
    )
    room.getPlayer(seatB).syncObservedHandCount(8)
    ;[...hiddenFromA, ...hiddenFromB].forEach((id) => {
      const card = getCard(room, id)
      expect(card.isKnown).toBe(false)
    })

    return { controller, room }
  }

  function setupCandidateController({
    candidateIDs,
    candidateSeats,
    deckIDs = [],
    hiddenHands,
    observedCounts
  }: {
    candidateIDs: number[]
    candidateSeats: number[]
    deckIDs?: number[]
    hiddenHands: Record<number, number[]>
    observedCounts: Record<number, number>
  }) {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: 1, ClientID: 100 },
        { SeatID: 2, ClientID: 200 },
        { SeatID: 3, ClientID: 300 }
      ],
      100
    )

    const hiddenIDs = Object.values(hiddenHands).flat()
    controller.initTrackerDeck(Array.from(new Set([...hiddenIDs, ...candidateIDs, ...deckIDs])))
    const room = controller.getTrackerRoom()!

    Object.entries(hiddenHands).forEach(([seatID, ids]) => {
      bindHiddenHand(room, ids, Number(seatID))
    })
    candidateIDs.forEach((id) => {
      const card = getCard(room, id)
      room.clearCardsFromPublicZones([card])
      card.bindCandidates(candidateSeats, 'hand', null, { known: true })
      room.notifyCardChanged(card, { type: 'test:hand-exchange-candidate' })
    })
    Object.entries(observedCounts).forEach(([seatID, count]) => {
      room.getPlayer(Number(seatID)).syncObservedHandCount(count)
    })

    return { controller, room }
  }

  function runTwoSeatExchange(
    controller: ReturnType<typeof createTrackerControllerHarness>['controller'],
    firstSeat: number,
    firstCount: number,
    secondSeat: number,
    secondCount: number
  ) {
    const steps = [
      protocolMove({
        CardIDs: [],
        CardCount: firstCount,
        FromID: firstSeat,
        FromZone: 5,
        ToID: firstSeat,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: secondCount,
        FromID: secondSeat,
        FromZone: 5,
        ToID: secondSeat,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: secondCount,
        FromID: secondSeat,
        FromZone: 10,
        ToID: firstSeat,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: firstCount,
        FromID: firstSeat,
        FromZone: 10,
        ToID: secondSeat,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      })
    ]
    steps.forEach((msg) => controller.syncTrackerMove(msg))
  }

  function runWholeHandExchange(spellID: number) {
    const { controller, room } = setupController()

    const steps = [
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromID: seatA,
        FromZone: 5,
        ToID: seatA,
        ToZone: 10,
        MoveType: 11,
        SpellID: spellID
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 8,
        FromID: seatB,
        FromZone: 5,
        ToID: seatB,
        ToZone: 10,
        MoveType: 11,
        SpellID: spellID
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 8,
        FromID: seatB,
        FromZone: 10,
        ToID: seatA,
        ToZone: 5,
        MoveType: 11,
        SpellID: spellID
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromID: seatA,
        FromZone: 10,
        ToID: seatB,
        ToZone: 5,
        MoveType: 11,
        SpellID: spellID
      })
    ]

    steps.forEach((msg) => controller.syncTrackerMove(msg))
    return room
  }

  it('装饰器：手牌进交换区时登记批次并拆明暗 sourceCards', () => {
    const { room } = setupController()
    const event = {
      type: 'moveCards',
      cardIDs: [],
      cardCount: 8,
      toZone: 'exchange',
      options: {
        fromSeatID: seatB,
        fromSubZone: 'hand',
        fromZone: null,
        cardCount: 8
      },
      raw: {
        CardIDs: [],
        CardCount: 8,
        FromID: seatB,
        FromZone: 5,
        ToID: seatB,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }
    }

    const decorated = room.decorateMoveEvent(event)
    expect([...decorated.cardIDs].sort((a: number, b: number) => a - b)).toEqual(
      [...knownFromB].sort((a, b) => a - b)
    )
    expect(decorated.options.sourceCards).toHaveLength(4)
    expect(
      decorated.options.sourceCards.every((card: { isKnown: boolean; id: number }) => {
        return card.isKnown !== true && hiddenFromB.includes(card.id)
      })
    ).toBe(true)
    expect(decorated.options.cardCount).toBe(8)

    const state = room.getSkillState(HAND_EXCHANGE_STATE_KEY)
    expect(state.bySpell['121'].batches[String(seatB)]).toHaveLength(1)
    expect(state.bySpell['121'].batches[String(seatB)][0].cards).toHaveLength(8)
  })

  it('技能 121：完整协议序列后双方手牌互换，明牌保持公开、暗牌不被误公开', () => {
    const room = runWholeHandExchange(121)

    expect(handIDs(room, seatA)).toEqual([...knownFromB, ...hiddenFromB].sort((a, b) => a - b))
    expect(handIDs(room, seatB)).toEqual([...hiddenFromA].sort((a, b) => a - b))
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)

    knownFromB.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.seats.has(seatA)).toBe(true)
      expect(card.isKnown).toBe(true)
    })

    hiddenFromA.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.seats.has(seatB)).toBe(true)
      expect(card.isKnown).toBe(false)
    })

    hiddenFromB.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.seats.has(seatA)).toBe(true)
      expect(card.isKnown).toBe(false)
    })

    expect(room.getPlayer(seatA).observedHandCount).toBe(8)
    expect(room.getPlayer(seatB).observedHandCount).toBe(4)
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('任意 SpellID 复用同一整手交换协议模式', () => {
    const room = runWholeHandExchange(9999)

    expect(handIDs(room, seatA)).toEqual([...knownFromB, ...hiddenFromB].sort((a, b) => a - b))
    expect(handIDs(room, seatB)).toEqual([...hiddenFromA].sort((a, b) => a - b))
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('双方整手全暗时仍按实体批次互换且不会公开身份', () => {
    const firstHandIDs = [551, 552]
    const secondHandIDs = [553, 554, 555]
    const { controller, room } = setupCandidateController({
      candidateIDs: [],
      candidateSeats: [],
      hiddenHands: {
        1: firstHandIDs,
        2: secondHandIDs
      },
      observedCounts: {
        1: firstHandIDs.length,
        2: secondHandIDs.length
      }
    })

    runTwoSeatExchange(controller, 1, firstHandIDs.length, 2, secondHandIDs.length)

    expect(handIDs(room, 1)).toEqual([...secondHandIDs].sort((a, b) => a - b))
    expect(handIDs(room, 2)).toEqual([...firstHandIDs].sort((a, b) => a - b))
    ;[...firstHandIDs, ...secondHandIDs].forEach((id) => {
      expect(getCard(room, id).isKnown).toBe(false)
    })
    expect(room.getPlayer(1).observedHandCount).toBe(secondHandIDs.length)
    expect(room.getPlayer(2).observedHandCount).toBe(firstHandIDs.length)
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('非整手的 5->10 交换不接管（避免误伤佐练类路径）', () => {
    const { room } = setupController()
    const event = {
      type: 'moveCards',
      cardIDs: [106],
      cardCount: 1,
      toZone: 'exchange',
      options: {
        fromSeatID: seatB,
        fromSubZone: 'hand',
        fromZone: null,
        cardCount: 1
      },
      raw: {
        CardIDs: [106],
        CardCount: 1,
        FromID: seatB,
        FromZone: 5,
        ToID: seatB,
        ToZone: 10,
        MoveType: 11,
        SpellID: 3488
      }
    }

    const decorated = room.decorateMoveEvent(event)
    expect(decorated.cardIDs).toEqual([106])
    expect(decorated.options?.sourceCards).toBeUndefined()
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('未登记批次回手时不创建空账本', () => {
    const { room } = setupController()
    const event = {
      type: 'moveCards',
      cardIDs: [],
      cardCount: 4,
      toZone: 'player',
      options: {
        seatID: seatB,
        subZone: 'hand',
        fromZone: 'exchange',
        cardCount: 4
      },
      raw: {
        CardIDs: [],
        CardCount: 4,
        FromID: seatA,
        FromZone: 10,
        ToID: seatB,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }
    }

    const decorated = room.decorateMoveEvent(event)
    expect(decorated.options?.sourceCards).toBeUndefined()
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('己方整手正 CardIDs 也会接管，并与对侧全暗批次完成互换', () => {
    const { controller, room } = setupController()

    // 模拟视角在 5 号：本机已知自己整手 8 张正 ID（4 明 + 4 暗实体 ID 也暴露给本机）
    const selfHandIDs = [...knownFromB, ...hiddenFromB]
    hiddenFromB.forEach((id) => {
      const card = getCard(room, id)
      // 协议给正 ID 前本地可能仍标暗；进区时装饰器会 confirmKnown
      expect(card.isKnown).toBe(false)
    })

    const steps = [
      // 4 号对侧：协议全暗整手
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromID: seatA,
        FromZone: 5,
        ToID: seatA,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      // 5 号己方：协议给整手正 ID
      protocolMove({
        CardIDs: selfHandIDs,
        CardCount: 8,
        FromID: seatB,
        FromZone: 5,
        ToID: seatB,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      // 原 5 号批次回 4 号：协议也可继续给正 ID
      protocolMove({
        CardIDs: selfHandIDs,
        CardCount: 8,
        FromID: seatB,
        FromZone: 10,
        ToID: seatA,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }),
      // 原 4 号批次回 5 号：对侧仍全暗
      protocolMove({
        CardIDs: [],
        CardCount: 4,
        FromID: seatA,
        FromZone: 10,
        ToID: seatB,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      })
    ]

    steps.forEach((msg) => controller.syncTrackerMove(msg))

    expect(handIDs(room, seatA)).toEqual([...selfHandIDs].sort((a, b) => a - b))
    expect(handIDs(room, seatB)).toEqual([...hiddenFromA].sort((a, b) => a - b))
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)

    // 协议正 ID 的己方整手在到 4 号后仍保持公开
    selfHandIDs.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.seats.has(seatA)).toBe(true)
      expect(card.isKnown).toBe(true)
    })

    // 对侧原暗牌到己方后仍不公开
    hiddenFromA.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.seats.has(seatB)).toBe(true)
      expect(card.isKnown).toBe(false)
    })

    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('结算中嵌套空手交换时不消费外层同座位批次', () => {
    const { controller, room } = setupController()
    bindHiddenHand(room, hiddenFromC, 3)
    room.getPlayer(3).syncObservedHandCount(hiddenFromC.length)

    const steps = [
      // 外层：4 号与 5 号的整手都先进入交换区，尚未回手。
      protocolMove({
        CardIDs: [],
        CardCount: hiddenFromA.length,
        FromID: seatA,
        FromZone: 5,
        ToID: seatA,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: knownFromB.length + hiddenFromB.length,
        FromID: seatB,
        FromZone: 5,
        ToID: seatB,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      // 内层：此时 4 号为空手，再与 3 号交换。
      protocolMove({
        CardIDs: [],
        CardCount: 0,
        FromID: seatA,
        FromZone: 5,
        ToID: seatA,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: hiddenFromC.length,
        FromID: 3,
        FromZone: 5,
        ToID: 3,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: hiddenFromC.length,
        FromID: 3,
        FromZone: 10,
        ToID: seatA,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 0,
        FromID: seatA,
        FromZone: 10,
        ToID: 3,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }),
      // 内层结算完成后，继续结算外层交换。
      protocolMove({
        CardIDs: [],
        CardCount: knownFromB.length + hiddenFromB.length,
        FromID: seatB,
        FromZone: 10,
        ToID: seatA,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: hiddenFromA.length,
        FromID: seatA,
        FromZone: 10,
        ToID: seatB,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      })
    ]

    steps.forEach((msg) => controller.syncTrackerMove(msg))

    expect(handIDs(room, seatA)).toEqual(
      [...knownFromB, ...hiddenFromB, ...hiddenFromC].sort((a, b) => a - b)
    )
    expect(handIDs(room, seatB)).toEqual([...hiddenFromA].sort((a, b) => a - b))
    expect(handIDs(room, 3)).toEqual([])
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('交换双方共享的手牌候选在座位置换后保持候选', () => {
    const candidateIDs = [601, 602]
    const { controller, room } = setupCandidateController({
      candidateIDs,
      candidateSeats: [1, 2],
      hiddenHands: {
        1: [501],
        2: [502]
      },
      observedCounts: {
        1: 2,
        2: 2
      }
    })

    runTwoSeatExchange(controller, 1, 2, 2, 2)

    expect(getCard(room, 501).seats).toEqual(new Set([2]))
    expect(getCard(room, 502).seats).toEqual(new Set([1]))
    candidateIDs.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.seats).toEqual(new Set([1, 2]))
      expect(card.isKnown).toBe(true)
    })
    expect(room.getPlayer(1).observedHandCount).toBe(2)
    expect(room.getPlayer(2).observedHandCount).toBe(2)
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('只涉及一名交换角色的候选会把该候选座位置换到接收者', () => {
    const candidateIDs = [611, 612]
    const { controller, room } = setupCandidateController({
      candidateIDs,
      candidateSeats: [1, 3],
      hiddenHands: {
        1: [511],
        2: [512],
        3: [513]
      },
      observedCounts: {
        1: 2,
        2: 1,
        3: 2
      }
    })

    runTwoSeatExchange(controller, 1, 2, 2, 1)

    expect(getCard(room, 511).seats).toEqual(new Set([2]))
    expect(getCard(room, 512).seats).toEqual(new Set([1]))
    expect(getCard(room, 513).seats).toEqual(new Set([3]))
    candidateIDs.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.seats).toEqual(new Set([2, 3]))
      expect(card.isKnown).toBe(true)
    })
    expect(room.getPlayer(1).observedHandCount).toBe(1)
    expect(room.getPlayer(2).observedHandCount).toBe(2)
    expect(room.getPlayer(3).observedHandCount).toBe(2)
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('己方收到完整明牌手牌时会确认出现候选并排除未出现候选', () => {
    const selfHandIDs = [531, 532]
    const candidateIDs = [631, 632]
    const { controller, room } = setupCandidateController({
      candidateIDs,
      candidateSeats: [2, 3],
      hiddenHands: {
        1: selfHandIDs,
        2: [533],
        3: [534]
      },
      observedCounts: {
        1: 2,
        2: 2,
        3: 2
      }
    })
    selfHandIDs.forEach((id) => getCard(room, id).confirmKnown())

    const steps = [
      protocolMove({
        CardIDs: selfHandIDs,
        CardCount: 2,
        FromID: 1,
        FromZone: 5,
        ToID: 1,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromID: 2,
        FromZone: 5,
        ToID: 2,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      // 己方收到的整手完全可见：631 属于 2 号原手牌，632 因未出现而只能属于 3 号。
      protocolMove({
        CardIDs: [533, 631],
        CardCount: 2,
        FromID: 2,
        FromZone: 10,
        ToID: 1,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: selfHandIDs,
        CardCount: 2,
        FromID: 1,
        FromZone: 10,
        ToID: 2,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      })
    ]
    steps.forEach((msg) => controller.syncTrackerMove(msg))

    expect(getCard(room, 531).seats).toEqual(new Set([2]))
    expect(getCard(room, 532).seats).toEqual(new Set([2]))
    expect(getCard(room, 533).seats).toEqual(new Set([1]))
    expect(getCard(room, 533).isKnown).toBe(true)
    expect(getCard(room, 631).seats).toEqual(new Set([1]))
    expect(getCard(room, 632).seats).toEqual(new Set([3]))
    expect(room.getPlayer(1).observedHandCount).toBe(2)
    expect(room.getPlayer(2).observedHandCount).toBe(2)
    expect(room.getPlayer(3).observedHandCount).toBe(2)
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('己方完整可见回手会用真实 ID 置换玩家 A 的匿名实体占位', () => {
    const selfHandIDs = [541, 542]
    const candidateIDs = [641, 642]
    const revealedPlaceholderID = 543
    const { controller, room } = setupCandidateController({
      candidateIDs,
      candidateSeats: [2, 3],
      deckIDs: [revealedPlaceholderID],
      hiddenHands: {
        1: selfHandIDs,
        3: [544]
      },
      observedCounts: {
        1: 2,
        2: 2,
        3: 2
      }
    })
    selfHandIDs.forEach((id) => getCard(room, id).confirmKnown())

    const placeholder = room.createExternalCards([], 1)[0]
    placeholder.bindCandidates([2], 'hand', null, { known: false })
    room.notifyCardChanged(placeholder, { type: 'test:hand-exchange-placeholder' })

    const steps = [
      protocolMove({
        CardIDs: selfHandIDs,
        CardCount: 2,
        FromID: 1,
        FromZone: 5,
        ToID: 1,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromID: 2,
        FromZone: 5,
        ToID: 2,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [revealedPlaceholderID, 641],
        CardCount: 2,
        FromID: 2,
        FromZone: 10,
        ToID: 1,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: selfHandIDs,
        CardCount: 2,
        FromID: 1,
        FromZone: 10,
        ToID: 2,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      })
    ]
    steps.forEach((msg) => controller.syncTrackerMove(msg))

    expect(getCard(room, revealedPlaceholderID).seats).toEqual(new Set([1]))
    expect(getCard(room, revealedPlaceholderID).isKnown).toBe(true)
    expect(getCard(room, 641).seats).toEqual(new Set([1]))
    expect(getCard(room, 642).seats).toEqual(new Set([3]))
    expect(placeholder.id).toBe(0)
    expect(placeholder.seats.has(1)).toBe(false)
    expect(room.getPlayer(1).observedHandCount).toBe(2)
    expect(room.getPlayer(2).observedHandCount).toBe(2)
    expect(room.getPlayer(3).observedHandCount).toBe(2)
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })

  it('嵌套空手交换会按各层批次依次置换候选座位', () => {
    const candidateIDs = [621, 622]
    const { controller, room } = setupCandidateController({
      candidateIDs,
      candidateSeats: [1, 3],
      hiddenHands: {
        1: [521],
        2: [522],
        3: [523]
      },
      observedCounts: {
        1: 2,
        2: 1,
        3: 2
      }
    })

    const steps = [
      // 外层先暂存 1、2 号整手。
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromID: 1,
        FromZone: 5,
        ToID: 1,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromID: 2,
        FromZone: 5,
        ToID: 2,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      // 内层由已经空手的 1 号与 3 号交换。
      protocolMove({
        CardIDs: [],
        CardCount: 0,
        FromID: 1,
        FromZone: 5,
        ToID: 1,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromID: 3,
        FromZone: 5,
        ToID: 3,
        ToZone: 10,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromID: 3,
        FromZone: 10,
        ToID: 1,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 0,
        FromID: 1,
        FromZone: 10,
        ToID: 3,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }),
      // 最后继续完成外层 1、2 号交换。
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromID: 2,
        FromZone: 10,
        ToID: 1,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      }),
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromID: 1,
        FromZone: 10,
        ToID: 2,
        ToZone: 5,
        MoveType: 11,
        SpellID: 121
      })
    ]
    steps.forEach((msg) => controller.syncTrackerMove(msg))

    expect(getCard(room, 521).seats).toEqual(new Set([2]))
    expect(getCard(room, 522).seats).toEqual(new Set([1]))
    expect(getCard(room, 523).seats).toEqual(new Set([1]))
    candidateIDs.forEach((id) => {
      const card = getCard(room, id)
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.seats).toEqual(new Set([1, 2]))
      expect(card.isKnown).toBe(true)
    })
    expect(room.getPlayer(1).observedHandCount).toBe(3)
    expect(room.getPlayer(2).observedHandCount).toBe(2)
    expect(room.getPlayer(3).observedHandCount).toBe(0)
    expect(room.zones.get('exchange')?.cards.length ?? 0).toBe(0)
    expect(room.skillState.has(HAND_EXCHANGE_STATE_KEY)).toBe(false)
  })
})
