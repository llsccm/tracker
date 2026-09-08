import { afterEach, describe, expect, it, vi } from 'vitest'
import { CardConfig } from '@/config/CardConfig'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { normalizeMoveEvent } from '@/tracker/MoveEventNormalizer'
import type { RawMoveCardEvent } from '@/tracker/types'
import { getCard } from './helpers/room'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

const CARD_SPELL_IDS: Record<string, number> = {
  杀: 1,
  火杀: 1,
  雷杀: 1,
  冰杀: 1,
  决斗: 8,
  南蛮: 9,
  南蛮入侵: 9,
  万箭: 10,
  万箭齐发: 10,
  火攻: 83
}

afterEach(() => {
  vi.restoreAllMocks()
})

function createRoomWithDiscard(
  cardNames: string[],
  cardSpellIds = cardNames.map((name) => CARD_SPELL_IDS[name] ?? 0)
) {
  const cardInfos = cardNames.map((name, index) => ({
    id: index + 1,
    name,
    spellId: cardSpellIds[index]
  }))
  vi.spyOn(CardConfig.GetInstance(), 'getCard').mockImplementation((id) => cardInfos[id - 1])

  const { controller } = createTrackerControllerHarness()
  controller.initTrackerRoom()
  controller.registerTrackerPlayers(
    [
      { SeatID: 1, ClientID: 100 },
      { SeatID: 7, ClientID: 700 }
    ],
    100
  )

  const cardIDs = cardNames.map((_, index) => index + 1)
  controller.initTrackerDeck(cardIDs)
  controller.syncTrackerMove(protocolMove({ CardIDs: cardIDs, ToZone: 2, ToID: 255, MoveType: 16 }))

  const room = controller.getTrackerRoom()!

  return { controller, room }
}

function createFenChaoMove(overrides: RawMoveCardEvent = {}) {
  return protocolMove({
    CardCount: 2,
    CardIDs: [],
    FromID: 255,
    FromPosition: POSITION_RANDOM,
    FromZone: 2,
    FromZoneParam: 0,
    MoveType: 18,
    SpellID: 3752,
    ToID: 7,
    ToPosition: POSITION_TOP,
    ToZone: 5,
    ToZoneParam: 0,
    ...overrides
  })
}

describe('焚巢弃牌堆取牌', () => {
  it.each([{ CardIDs: [] }, { CardIDs: [0, 0] }])(
    '未公开牌 ID $CardIDs 时按入堆先后获得两张目标明牌',
    ({ CardIDs }) => {
      const { controller, room } = createRoomWithDiscard([
        '闪',
        '决斗',
        '桃',
        '杀',
        '南蛮',
        '万箭',
        '火攻'
      ])
      const message = createFenChaoMove({ CardIDs })
      const originalCardIDs = [...CardIDs]

      controller.syncTrackerMove(message)

      const player = room.players.get(7)!
      expect(player.knownHandCards.map((card) => card.id).sort((a, b) => a - b)).toEqual([2, 4])
      expect(player.observedHandCount).toBe(2)
      expect(player.unknownCardCount).toBe(0)
      expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([1, 3, 5, 6, 7])
      expect(room.zones.get('pile')!.cards).toEqual([])
      expect(room.cards).toHaveLength(7)
      expect(message.CardIDs).toEqual(originalCardIDs)
    }
  )

  it.each(['杀', '火杀', '雷杀', '冰杀', '决斗', '南蛮', '南蛮入侵', '万箭', '万箭齐发', '火攻'])(
    '识别 %s 并优先获得同名牌中最早入堆的一张',
    (name) => {
      const { controller, room } = createRoomWithDiscard(['闪', name, '桃', name, '无懈'])

      controller.syncTrackerMove(createFenChaoMove({ CardCount: 1 }))

      expect(room.players.get(7)!.knownHandCards.map((card) => card.id)).toEqual([2])
      expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([1, 3, 4, 5])
    }
  )

  it.each([1, 8, 9, 10, 83])('按卡牌技能 ID %i 识别目标牌，不受显示名影响', (spellId) => {
    const { controller, room } = createRoomWithDiscard(
      ['杀', '更名后的卡牌', '决斗'],
      [7, spellId, 0]
    )

    controller.syncTrackerMove(createFenChaoMove({ CardCount: 1 }))

    expect(room.players.get(7)!.knownHandCards.map((card) => card.id)).toEqual([2])
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([1, 3])
    expect(getCard(room, 2)!.spellId).toBe(spellId)
    expect(getCard(room, 2)!.spellID).toBe(3752)
  })

  it('连续获得按当前弃牌顺序继续筛选，张数以协议为准', () => {
    const { controller, room } = createRoomWithDiscard([
      '火攻',
      '闪',
      '南蛮',
      '决斗',
      '杀',
      '万箭',
      '桃'
    ])

    controller.syncTrackerMove(createFenChaoMove())
    controller.syncTrackerMove(createFenChaoMove({ CardCount: 3 }))

    const player = room.players.get(7)!
    expect(player.knownHandCards.map((card) => card.id).sort((a, b) => a - b)).toEqual([
      1, 3, 4, 5, 6
    ])
    expect(player.observedHandCount).toBe(5)
    expect(player.unknownCardCount).toBe(0)
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([2, 7])
  })

  it('牌离开后重新弃入时，以本次入堆顺序为准', () => {
    const { controller, room } = createRoomWithDiscard(['杀', '火攻', '决斗', '闪'])
    controller.syncTrackerMove(createFenChaoMove({ CardCount: 1, CardIDs: [1], SpellID: 0 }))
    controller.syncTrackerMove(
      protocolMove({ CardIDs: [1], FromZone: 5, FromID: 7, ToZone: 2, ToID: 255, MoveType: 4 })
    )

    controller.syncTrackerMove(createFenChaoMove())

    expect(
      room.players
        .get(7)!
        .knownHandCards.map((card) => card.id)
        .sort((a, b) => a - b)
    ).toEqual([2, 3])
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([4, 1])
  })

  it('协议明确给出牌 ID 时沿用真实身份，不按最早入堆规则覆盖', () => {
    const { controller, room } = createRoomWithDiscard(['杀', '闪', '决斗', '火攻'])

    controller.syncTrackerMove(createFenChaoMove({ CardCount: 1, CardIDs: [4] }))

    expect(room.players.get(7)!.knownHandCards.map((card) => card.id)).toEqual([4])
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([1, 2, 3])
  })

  it('来源含匿名牌时复用不同实体补足数量，保留已识别明牌', () => {
    const { controller, room } = createRoomWithDiscard(['火攻', '闪'])
    controller.syncTrackerMove(
      protocolMove({ CardCount: 1, CardIDs: [], FromZone: 0, ToZone: 2, ToID: 255, MoveType: 19 })
    )

    controller.syncTrackerMove(createFenChaoMove())

    const player = room.players.get(7)!
    expect(player.knownHandCards.map((card) => card.id)).toEqual([1])
    expect(player.observedHandCount).toBe(2)
    expect(player.unknownCardCount).toBe(1)
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([2])
    expect(room.cards).toHaveLength(3)
  })

  it.each([
    { scenario: '其他技能', overrides: { SpellID: 9999 } },
    { scenario: '牌堆来源', overrides: { FromZone: 1 } },
    { scenario: '非手牌目标', overrides: { ToZone: 6 } },
    { scenario: '非获得移动', overrides: { MoveType: 4 } },
    { scenario: '明确端点取牌', overrides: { FromPosition: POSITION_TOP } },
    { scenario: '零张移动', overrides: { CardCount: 0 } }
  ])('$scenario 不应用焚巢来源推断', ({ overrides }) => {
    const { room } = createRoomWithDiscard(['杀', '决斗', '闪'])
    const event = room.decorateMoveEvent(normalizeMoveEvent(createFenChaoMove(overrides)))

    expect(event.options.sourceCards).toBeUndefined()
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([1, 2, 3])
  })

  it('没有目标牌时保留默认移动，不将其他锦囊纳入焚巢筛选', () => {
    const { room } = createRoomWithDiscard(['闪', '桃', '借刀', '水淹', '火烧'])
    const event = room.decorateMoveEvent(normalizeMoveEvent(createFenChaoMove()))

    expect(event.options.sourceCards).toBeUndefined()
  })
})
