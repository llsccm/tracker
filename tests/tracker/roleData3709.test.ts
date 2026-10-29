import { describe, expect, it, vi } from 'vitest'
import { parseGuiFuCardIDs } from '@/tracker/skill/GuiFu'
import { GUI_FU_ROLE_DATA_ID } from '@/tracker/protocol/protocolRules'
import type { Room } from '@/tracker/Room'
import type { RawMoveCardEvent, TrackerControllerOptions } from '@/tracker/types'
import { trackerLogger } from '@/utils/logger'
import { protocolMove, createReadyControllerHarness } from './helpers/trackerController'

function getHandIDs(room: Room, seatID = 2) {
  return room.cards
    .filter(
      (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(seatID)
    )
    .map((card) => card.id)
    .sort((left, right) => left - right)
}

function createGuiFuHarness(options: TrackerControllerOptions = {}) {
  const { controller, room } = createReadyControllerHarness({
    ...options,
    seatIDs: [1, 2, 3],
    cardIDs: [10, 20, 30, 40, 50, 60]
  })
  room.syncObservedPlayerHandCount(2, 0)
  controller.syncTrackerMove(
    protocolMove({
      CardIDs: [10, 20, 30],
      CardCount: 3,
      FromZone: 1,
      ToZone: 2,
      ToID: 255,
      MoveType: 4
    })
  )
  return {
    controller,
    room,
    gain(overrides: Partial<RawMoveCardEvent> = {}) {
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [],
          CardCount: 1,
          FromZone: 2,
          FromPosition: 65282,
          ToID: 2,
          ToZone: 5,
          MoveType: 18,
          SpellID: GUI_FU_ROLE_DATA_ID,
          ...overrides
        })
      )
    },
    receive(cardIDs: number[], seatID = 2) {
      controller.dispatchSkillProtocolEvent({
        type: 'roleData',
        message: {
          DataID: GUI_FU_ROLE_DATA_ID,
          SeatID: seatID,
          Datas: [cardIDs.length, ...cardIDs, 0, 0]
        }
      })
    }
  }
}

function expectHand(room: Room, cardIDs: number[]) {
  expect(getHandIDs(room)).toEqual([...cardIDs].sort((left, right) => left - right))
  expect(room.getPlayer(2)?.observedHandCount).toBe(cardIDs.length)
  expect(room.getPlayer(2)?.unknownCardCount).toBe(0)
  expect(room.assertPileIdentityLedgerConsistency('guiFu-paired-move')).toEqual([])
  expect(room.hasSkillState(GUI_FU_ROLE_DATA_ID)).toBe(false)
}

describe('GsCUpdateRoleDataExNtf 3709 相邻消息补全', () => {
  it('按数量读取当前持有列表，忽略尾部补位零', () => {
    expect(parseGuiFuCardIDs([2, 20, 10, 0, 0])).toEqual([20, 10])
    expect(parseGuiFuCardIDs([0, 0])).toEqual([])
    expect(parseGuiFuCardIDs(undefined)).toEqual([])
    expect(parseGuiFuCardIDs([2, 20])).toEqual([])
    expect(parseGuiFuCardIDs([2, 20, 0])).toEqual([])
  })

  it('通用协议入口配对非主视角的当前持有列表', () => {
    const { room, gain, receive } = createGuiFuHarness()
    gain({ CardCount: 2 })
    receive([20, 10])
    expectHand(room, [10, 20])
  })

  it('主视角、非玩家端点和未知视角不重复同步', () => {
    const { room, gain, receive } = createGuiFuHarness()
    gain()
    const move = vi.spyOn(room, 'moveCards')
    receive([10], 1)
    receive([10], 255)
    room.mySeatID = undefined
    receive([10], 2)
    expect(move).not.toHaveBeenCalled()
  })

  it.each([1, 2])('来源区域 %i 在配对前不创建占位或提交数量，之后只移动一次', (fromZone) => {
    const { room, gain, receive } = createGuiFuHarness()
    const cardIDs = fromZone === 1 ? [40, 50] : [20, 10]
    const source = room.zones.get(fromZone === 1 ? 'pile' : 'discard')!
    const sourceCards = [...source.cards]
    const allCards = [...room.cards]
    const move = vi.spyOn(room, 'moveCards')
    const ledgerMove = vi.spyOn(room, 'applyPileIdentityMove')
    gain({ FromZone: fromZone, CardCount: 2 })
    expect(getHandIDs(room)).toEqual([])
    expect(room.getPlayer(2)?.observedHandCount).toBe(0)
    expect(room.cards).toEqual(allCards)
    expect(source.cards).toEqual(sourceCards)
    expect(room.hasSkillState(GUI_FU_ROLE_DATA_ID)).toBe(true)
    expect(move).not.toHaveBeenCalled()
    expect(ledgerMove).not.toHaveBeenCalled()
    expect(room.assertPileIdentityLedgerConsistency('guiFu-deferred')).toEqual([])
    receive(cardIDs)
    expectHand(room, cardIDs)
    expect(source.cards).toHaveLength(sourceCards.length - 2)
    expect(room.cards).toHaveLength(allCards.length)
    expect(move).toHaveBeenCalledTimes(1)
    expect(ledgerMove).toHaveBeenCalledTimes(1)
    for (const cardID of cardIDs) {
      expect(room.cardIndex.get(cardID)).toMatchObject({ location: 'player', isKnown: true })
    }
  })

  it('弃牌只移走对应实体，其余弃牌保持顺序与明牌状态', () => {
    const { room, gain, receive } = createGuiFuHarness()
    const discard = room.zones.get('discard')!
    const before = [...discard.cards]
    const selected = room.cardIndex.get(20)
    gain()
    receive([20])
    expectHand(room, [20])
    expect(room.cardIndex.get(20)).toBe(selected)
    expect(discard.cards).toEqual(before.filter((card) => card.id !== 20))
    expect(discard.cards.every((card) => card.isKnown)).toBe(true)
  })

  it.each([{ cardIDs: [30, 20, 10] }, { cardIDs: [30, 10, 20] }, { cardIDs: [10, 30, 20] }])(
    '累计列表 $cardIDs 按既有手牌排除旧身份，不依赖新增牌位置',
    ({ cardIDs }) => {
      const { room, gain, receive } = createGuiFuHarness()
      gain()
      receive([10])
      gain({ CardCount: 2 })
      receive(cardIDs)
      expectHand(room, [10, 20, 30])
      expect(room.zones.get('discard')!.cards).toHaveLength(0)
    }
  )

  it.each([1, 2])('来源区域 %i 的新增牌排在旧牌后仍只提交一次获得', (fromZone) => {
    const { room, gain, receive } = createGuiFuHarness()
    gain()
    receive([10])
    const oldCard = room.cardIndex.get(10)
    const allCards = [...room.cards]
    const source = room.getZone(fromZone === 1 ? 'pile' : 'discard')
    const sourceCount = source.cards.length
    const newID = fromZone === 1 ? 40 : 20
    const move = vi.spyOn(room, 'moveCards')
    const ledgerMove = vi.spyOn(room, 'applyPileIdentityMove')

    gain({ FromZone: fromZone })
    receive([10, newID])
    receive([newID, 10])

    expectHand(room, [10, newID])
    expect(room.cardIndex.get(10)).toBe(oldCard)
    expect(room.cards).toEqual(allCards)
    expect(source.cards).toHaveLength(sourceCount - 1)
    expect(move).toHaveBeenCalledTimes(1)
    expect(ledgerMove).toHaveBeenCalledTimes(1)
  })

  it('乱序诡伏获得后再失牌，保留普通暗手牌槽供终局揭示物化', () => {
    const { controller, room, gain, receive } = createGuiFuHarness()
    gain()
    receive([10])
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1, ToID: 2 }))
    const anonymousHand = room.cards.find(
      (card) => card.isAnonymous && card.location === 'player' && card.owner === 2
    )!
    const allCards = [...room.cards]
    const createExternal = vi.spyOn(room, 'createExternalCards')

    gain()
    receive([10, 20])
    expect(room.getPlayer(2)?.observedHandCount).toBe(3)
    expect(room.getPlayer(2)?.unknownCardCount).toBe(1)
    controller.syncTrackerMove(
      protocolMove({ CardIDs: [20], FromZone: 5, FromID: 2, ToZone: 2, ToID: 255, MoveType: 4 })
    )
    expect(room.getPlayer(2)?.observedHandCount).toBe(2)
    expect(room.getPlayer(2)?.unknownCardCount).toBe(1)
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [10, 50],
        CardCount: 2,
        FromZone: 5,
        FromID: 2,
        ToZone: 5,
        ToID: 2,
        MoveType: 24
      })
    )

    expectHand(room, [10, 50])
    expect(room.cardIndex.get(50)).toBe(anonymousHand)
    expect(room.cards).toEqual(allCards)
    expect(createExternal).not.toHaveBeenCalled()
  })

  it('牌堆与弃牌获得各自相邻配对，共用普通移动管线', () => {
    const { room, gain, receive } = createGuiFuHarness()
    gain()
    receive([10])
    gain({ FromZone: 1 })
    receive([40, 10])
    gain()
    receive([20, 40, 10])
    expectHand(room, [10, 20, 40])
    expect(room.zones.get('pile')!.cards).toHaveLength(2)
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([30])
  })

  it('重复、缩短和空快照没有前置移动时不产生额外移动', () => {
    const { room, gain, receive } = createGuiFuHarness()
    gain({ CardCount: 2 })
    receive([20, 10])
    const move = vi.spyOn(room, 'moveCards')
    receive([20, 10])
    receive([10])
    receive([])
    expectHand(room, [10, 20])
    expect(move).not.toHaveBeenCalled()
  })

  it.each([10, 20])('旧牌离手后，新快照可以只包含本次获得的 %i', (nextID) => {
    const { controller, room, gain, receive } = createGuiFuHarness()
    gain()
    receive([10])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [10],
        FromZone: 5,
        FromID: 2,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )
    receive([])
    expectHand(room, [])
    gain()
    receive([nextID])
    expectHand(room, [nextID])
  })

  it.each([1, 2])('携带真实 ID 的座位 %i 沿用普通移动，不重复消费角色数据', (seatID) => {
    const { room, gain, receive } = createGuiFuHarness()
    gain({ CardIDs: [20], ToID: seatID })
    expect(room.hasSkillState(GUI_FU_ROLE_DATA_ID)).toBe(false)
    expect(getHandIDs(room, seatID)).toEqual([20])
    const move = vi.spyOn(room, 'moveCards')
    receive([20], seatID)
    expect(getHandIDs(room, seatID)).toEqual([20])
    expect(move).not.toHaveBeenCalled()
  })

  it('牌堆随机获得不消耗其它已公开牌顶', () => {
    const { controller, room, gain, receive } = createGuiFuHarness()
    controller.revealTrackerCards({ type: 'public', zoneName: 'pile', position: 65280 }, [60])
    const top = room.cardIndex.get(60)
    gain({ FromZone: 1 })
    receive([40])
    expectHand(room, [40])
    expect(room.zones.get('pile')!.cards.at(-1)).toBe(top)
    expect(top?.isKnown).toBe(true)
  })

  it('其它技能的普通匿名移动不受延迟配对影响', () => {
    const { room, gain } = createGuiFuHarness()
    gain({ FromZone: 1, SpellID: 0 })
    expect(getHandIDs(room)).toHaveLength(1)
    expect(room.getPlayer(2)?.observedHandCount).toBe(1)
    expect(room.hasSkillState(GUI_FU_ROLE_DATA_ID)).toBe(false)
    expect(room.assertPileIdentityLedgerConsistency('ordinary-anonymous-gain')).toEqual([])
  })

  it.each([
    { gainedIDs: [10], remainingIDs: [] },
    { gainedIDs: [20, 10], remainingIDs: [20] }
  ])('诡伏牌使用后同步 $remainingIDs 不会重复移动剩余手牌', ({ gainedIDs, remainingIDs }) => {
    const { controller, room, gain, receive } = createGuiFuHarness()
    gain({ CardCount: gainedIDs.length })
    receive(gainedIDs)
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [10],
        FromZone: 5,
        FromID: 2,
        ToZone: 3,
        ToID: 255,
        MoveType: 2
      })
    )
    const move = vi.spyOn(room, 'moveCards')
    const ledgerMove = vi.spyOn(room, 'applyPileIdentityMove')

    receive(remainingIDs)

    expectHand(room, remainingIDs)
    expect(room.cardIndex.get(10)?.location).toBe('process')
    expect(move).not.toHaveBeenCalled()
    expect(ledgerMove).not.toHaveBeenCalled()

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [10],
        FromZone: 3,
        FromID: 255,
        ToZone: 2,
        ToID: 255,
        MoveType: 16
      })
    )
    expectHand(room, remainingIDs)
    expect(room.cardIndex.get(10)?.location).toBe('discard')
  })

  it('获得技能触发的独立角色数据不会清空既有手牌或创建待配对移动', () => {
    const { controller, room, gain, receive } = createGuiFuHarness()
    controller.syncTrackerMove(protocolMove({ CardIDs: [40], ToID: 2 }))
    const move = vi.spyOn(room, 'moveCards')
    const ledgerMove = vi.spyOn(room, 'applyPileIdentityMove')

    receive([])

    expectHand(room, [40])
    expect(move).not.toHaveBeenCalled()
    expect(ledgerMove).not.toHaveBeenCalled()

    gain()
    receive([10])
    expectHand(room, [10, 40])
  })

  it('缺少前置移动时不猜测来源，也不把角色数据当新增手牌', () => {
    const { room, receive } = createGuiFuHarness()
    const pile = [...room.zones.get('pile')!.cards]
    const discard = [...room.zones.get('discard')!.cards]
    receive([40, 10])
    expectHand(room, [])
    expect(room.zones.get('pile')!.cards).toEqual(pile)
    expect(room.zones.get('discard')!.cards).toEqual(discard)
  })

  it.each([{ cardIDs: [] }, { cardIDs: [0] }])(
    '补全 $cardIDs 时只改 patched，保留原始消息和已有预处理补丁',
    ({ cardIDs }) => {
      const info = vi.fn()
      const { controller, room, receive } = createGuiFuHarness({
        logger: { info, debug: vi.fn(), warn: vi.fn() }
      })
      const raw = protocolMove({
        CardIDs: cardIDs,
        CardCount: 1,
        FromZone: 1,
        FromPosition: 65280,
        ToID: 2,
        MoveType: 18,
        SpellID: GUI_FU_ROLE_DATA_ID
      })
      const patched = { ...raw, CardIDs: [...cardIDs], FromPosition: 65282 }
      Object.freeze(raw.CardIDs)
      Object.freeze(raw)
      Object.freeze(patched.CardIDs)
      Object.freeze(patched)
      info.mockClear()

      controller.syncTrackerMove(patched, raw)
      const pending = room.readSkillState<{ raw: unknown; patched: unknown }>(GUI_FU_ROLE_DATA_ID)
      expect(pending?.raw).toEqual(raw)
      expect(pending?.raw).not.toBe(raw)
      expect(pending?.patched).toEqual(patched)
      expect(pending?.patched).not.toBe(patched)
      receive([40])

      expectHand(room, [40])
      expect(info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          raw: expect.objectContaining({ CardIDs: cardIDs, FromPosition: 65280 }),
          patched: expect.objectContaining({ CardIDs: [40], FromPosition: 65282 })
        })
      )
      expect(raw.CardIDs).toEqual(cardIDs)
      expect(raw.FromPosition).toBe(65280)
      expect(patched).toEqual({ ...raw, CardIDs: cardIDs, FromPosition: 65282 })
    }
  )

  it.each([
    { name: '座位不符', count: 1, seatID: 3, cardIDs: [10] },
    { name: '不足以覆盖本次获得张数', count: 2, seatID: 2, cardIDs: [10] },
    { name: '未定位到唯一的本次新增身份', count: 1, seatID: 2, cardIDs: [10, 20] },
    { name: '新增身份重复', count: 2, seatID: 2, cardIDs: [10, 10] },
    { name: '身份不在声明的弃牌来源', count: 1, seatID: 2, cardIDs: [40] }
  ])('$name 时告警取消，不部分结算或残留状态', ({ count, seatID, cardIDs }) => {
    const { room, gain, receive } = createGuiFuHarness()
    const warn = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})
    try {
      gain({ CardCount: count })
      receive(cardIDs, seatID)
      expectHand(room, [])
      expect(room.zones.get('discard')!.cards).toHaveLength(3)
      expect(warn).toHaveBeenCalledWith(
        '诡伏相邻角色数据与待补全移动不匹配，已取消移动',
        expect.objectContaining({ seatID, cardIDs })
      )
      gain()
      receive([20])
      expectHand(room, [20])
    } finally {
      warn.mockRestore()
    }
  })

  it('新的普通移动会释放未配对事件，晚到的角色数据不再移动旧牌', () => {
    const { controller, room, gain, receive } = createGuiFuHarness()
    const warn = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})
    try {
      gain()
      controller.syncTrackerMove(protocolMove({ CardIDs: [40], ToID: 3 }))
      receive([10])
      expectHand(room, [])
      expect(getHandIDs(room, 3)).toEqual([40])
      expect(warn).toHaveBeenCalledWith(
        '诡伏移动未收到相邻角色数据，已丢弃待补全移动',
        expect.any(Object)
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('新诡伏移动替换未配对事件，不维护跨座位 FIFO', () => {
    const { room, gain, receive } = createGuiFuHarness()
    gain({ ToID: 3 })
    gain()
    receive([20])
    expectHand(room, [20])
    expect(getHandIDs(room, 3)).toEqual([])
  })

  it('重新初始化牌堆清除未配对状态', () => {
    const { controller, room, gain, receive } = createGuiFuHarness()
    gain()
    controller.initTrackerDeck([10, 20, 30, 40, 50, 60])
    receive([10])
    expectHand(room, [])
    expect(room.zones.get('pile')!.cards).toHaveLength(6)
  })

  it('销毁与新建 Room 不继承上一局的未配对移动', () => {
    const { controller, room, gain, receive } = createGuiFuHarness()
    gain()
    controller.destroyTrackerRoom()
    expect(room.hasSkillState(GUI_FU_ROLE_DATA_ID)).toBe(false)
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 2, ClientID: 200 }], 100)
    controller.initTrackerDeck([10, 20])
    receive([10])
    const nextRoom = controller.getTrackerRoom()!
    expect(getHandIDs(nextRoom)).toEqual([])
    expect(nextRoom.zones.get('pile')!.cards).toHaveLength(2)
    expect(nextRoom.hasSkillState(GUI_FU_ROLE_DATA_ID)).toBe(false)
  })
  it('诡伏暂存不构造标准事件，配对成功后才归一化一次', async () => {
    const { room, gain, receive } = createGuiFuHarness()
    const normalize = vi.spyOn(
      await import('@/tracker/protocol/MoveEventNormalizer'),
      'normalizeMoveEvent'
    )
    try {
      gain()
      expect(room.readSkillState(GUI_FU_ROLE_DATA_ID)).toBeDefined()
      expect(normalize).not.toHaveBeenCalled()

      receive([10])

      expect(normalize).toHaveBeenCalledOnce()
      expectHand(room, [10])
    } finally {
      normalize.mockRestore()
    }
  })
})
