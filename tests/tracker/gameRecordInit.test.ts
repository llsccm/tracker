import { describe, expect, it } from 'vitest'
import { GameState } from '@/tracker/Game'
import { createTrackerControllerHarness } from './helpers/trackerController'

const gameId = { low: -1804863040, high: 207369892, unsigned: true }

describe('录像对局初始化', () => {
  it.each(['两次通知后注册座位', '两次通知之间注册座位', '注册座位后收到两次通知'])(
    '%s 时保留模式和当前局状态',
    (order) => {
      const { controller, gameState } = createTrackerControllerHarness()
      gameState.updateRecordInfo({ gameId: { ...gameId, low: 1 }, matchName: '斗地主' })
      controller.initTrackerRoom()

      if (order === '注册座位后收到两次通知') {
        controller.initTrackerRoom()
        controller.registerTrackerPlayers([{ seat_id: 2, user_temp_id: 100 }], 200)
      }
      gameState.updateRecordInfo({ gameId: { ...gameId }, matchName: '新欢乐排位' })
      if (order === '两次通知后注册座位') {
        gameState.updateRecordInfo({ gameId: { ...gameId }, matchName: '新欢乐排位' })
      }
      if (order !== '注册座位后收到两次通知') {
        controller.initTrackerRoom()
        controller.registerTrackerPlayers([{ seat_id: 2, user_temp_id: 100 }], 200)
      }
      const room = controller.getTrackerRoom()!
      gameState.setTurn(3)
      gameState.enter(0, 2)
      gameState.configHandCards = [11, 12]
      const spellState = { count: 2 }
      const trackerState = { cardIDs: [11] }
      gameState.setSpellState('record-init', spellState)
      room.setSkillState('record-init', trackerState)

      gameState.updateRecordInfo({ gameId: { ...gameId }, matchName: '新欢乐排位' })

      expect(gameState.needShowName).toBe(true)
      expect(gameState.isDouDiZhu).toBe(false)
      expect(gameState.isRecord).toBe(true)
      expect(gameState.isGameStart).toBe(true)
      expect(gameState.room).toBe(room)
      expect(gameState.seatIDs).toEqual([2])
      expect(gameState.size).toBe(1)
      expect(gameState.getCurrentTimestamp()).toEqual({ turn: 3, round: 1, phase: 0 })
      expect(gameState.currentID).toBe(2)
      expect(gameState.configHandCards).toEqual([11, 12])
      expect(gameState.getSpellState('record-init')).toBe(spellState)
      expect(room.readSkillState('record-init')).toBe(trackerState)
    }
  )

  it('播放中重新播放同一录像时重建 Room、重置整轮状态并恢复模式默认值', () => {
    const { controller, gameState } = createTrackerControllerHarness()
    gameState.updateRecordInfo({ gameId, matchName: '单骑无双' })
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ seat_id: 1, user_temp_id: 100 }], 100)
    controller.setTrackerFirstHand(1)
    controller.initTrackerDeck([1, 2])
    const oldRoom = controller.getTrackerRoom()!
    gameState.setTurn(4)
    gameState.enter(0, 1)
    gameState.enter(4, 1)
    gameState.configHandCards = [1, 2]
    gameState.configHandCardsMode = 'selected'
    gameState.configHandCardsRejected = true
    gameState.isGuoZhan = true
    gameState.isDouDiZhu = true
    gameState.isShanHeTu = true
    gameState.isSWJG = true
    gameState.zhanfaSet.add(1)
    gameState.setSpellState('old-room', true)
    oldRoom.setSkillState('old-room', true)

    // 点击重新播放后先到的同局元信息不能提前清理正在播放的状态。
    gameState.updateRecordInfo({ gameId: { ...gameId }, matchName: '单骑无双' })
    expect(gameState.turn).toBe(4)
    expect(gameState.room).toBe(oldRoom)
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ seat_id: 2, user_temp_id: 200 }], 100)
    const newRoom = controller.getTrackerRoom()!

    expect(newRoom).not.toBe(oldRoom)
    expect(oldRoom.players.size).toBe(0)
    expect(newRoom.isDeckReady).toBe(false)
    expect(newRoom.firstID).toBeUndefined()
    expect(gameState.myID).toBeUndefined()
    expect(gameState.seatIDs).toEqual([2])
    expect(gameState.isRecord).toBe(true)
    expect(gameState.isGameStart).toBe(true)
    expect(gameState.isPassed).toBe(false)
    expect(gameState.getCurrentTimestamp()).toEqual({ turn: 0, round: 0, phase: 0 })
    expect(gameState.currentID).toBeUndefined()
    expect(gameState.configHandCards).toEqual([])
    expect(gameState.configHandCardsMode).toBe('all')
    expect(gameState.configHandCardsRejected).toBe(false)
    expect(gameState.isGuoZhan).toBe(false)
    expect(gameState.isDouDiZhu).toBe(false)
    expect(gameState.isShanHeTu).toBe(false)
    expect(gameState.isSWJG).toBe(false)
    expect(gameState.zhanfaSet.size).toBe(0)
    expect(gameState.isRoguelike1v1).toBe(true)
    expect(gameState.needShowName).toBe(true)
    expect(gameState.getSpellState('old-room')).toBeUndefined()
    expect(gameState.readState('tracker', 'old-room')).toBeUndefined()
    gameState.setTurn(4)
    newRoom.setSkillState('new-room', true)
    gameState.updateRecordInfo({ gameId: { ...gameId }, matchName: '单骑无双' })
    expect(gameState.turn).toBe(4)
    expect(newRoom.readSkillState('new-room')).toBe(true)
    expect(gameState.seatIDs).toEqual([2])
  })

  it.each([
    { ...gameId, low: gameId.low + 1 },
    { ...gameId, high: gameId.high + 1 }
  ])('新 gameId 即使模式相同也更新模式，但运行状态等到座位消息才重置：%j', (nextGameId) => {
    const { controller, gameState } = createTrackerControllerHarness()
    gameState.updateRecordInfo({ gameId, matchName: '新欢乐排位' })
    controller.initTrackerRoom()
    gameState.setTurn(5)
    gameState.setSpellState('old-game', true)
    gameState.setState('tracker', 'old-game', true)
    gameState.isGuoZhan = true

    gameState.updateRecordInfo({ gameId: nextGameId, matchName: '新欢乐排位' })

    expect(gameState.turn).toBe(5)
    expect(gameState.getSpellState('old-game')).toBe(true)
    expect(gameState.readState('tracker', 'old-game')).toBe(true)
    expect(gameState.isGuoZhan).toBe(false)
    expect(gameState.needShowName).toBe(true)

    controller.initTrackerRoom()
    expect(gameState.turn).toBe(0)
    expect(gameState.getSpellState('old-game')).toBeUndefined()
    expect(gameState.readState('tracker', 'old-game')).toBeUndefined()
    expect(gameState.isGuoZhan).toBe(false)
    expect(gameState.needShowName).toBe(true)
  })

  it('相同 ID 的有符号和无符号低位表示属于同一局', () => {
    const gameState = new GameState()
    gameState.updateRecordInfo({ gameId, matchName: '新欢乐排位' })
    gameState.setTurn(5)
    gameState.isGuoZhan = true

    gameState.updateRecordInfo({ gameId: { ...gameId, low: gameId.low >>> 0 } })

    expect(gameState.turn).toBe(5)
    expect(gameState.needShowName).toBe(true)
    expect(gameState.isGuoZhan).toBe(true)
  })

  it('同局第二条通知可以补充模式，缺省名称与重复名称不覆盖后续牌堆识别', () => {
    const gameState = new GameState()
    gameState.updateRecordInfo({ gameId })
    gameState.setTurn(2)
    gameState.updateRecordInfo({ gameId, matchName: '新欢乐排位' })
    expect(gameState.needShowName).toBe(true)

    gameState.isGuoZhan = true
    gameState.isDouDiZhu = true
    gameState.isShanHeTu = true
    gameState.updateRecordInfo({ gameId, matchName: '' })
    gameState.updateRecordInfo({ gameId })
    gameState.updateRecordInfo({ gameId, matchName: '新欢乐排位' })

    expect(gameState.turn).toBe(2)
    expect(gameState.needShowName).toBe(true)
    expect(gameState.isGuoZhan).toBe(true)
    expect(gameState.isDouDiZhu).toBe(true)
    expect(gameState.isShanHeTu).toBe(true)
  })

  it('结束或显式重置后可重新打开同一 gameId 的录像', () => {
    const gameState = new GameState()
    for (const finish of [() => gameState.end(), () => gameState.reset()]) {
      gameState.updateRecordInfo({ gameId, matchName: '斗地主' })
      gameState.beginPlayback()
      gameState.setTurn(6)
      gameState.setSpellState('previous-playback', true)
      finish()

      expect(gameState.isDouDiZhu).toBe(false)
      expect(gameState.needShowName).toBe(false)
      expect(gameState.getSpellState('previous-playback')).toBeUndefined()

      gameState.updateRecordInfo({ gameId, matchName: '斗地主' })
      gameState.beginPlayback()
      expect(gameState.isGameStart).toBe(true)
      expect(gameState.turn).toBe(0)
      expect(gameState.isDouDiZhu).toBe(true)
      expect(gameState.needShowName).toBe(true)
    }
  })

  it('尚未收到座位消息就退出时也清除模式和 gameId', () => {
    const gameState = new GameState()
    gameState.updateRecordInfo({ gameId, matchName: '单骑无双' })
    expect(gameState.isGameStart).toBe(false)
    gameState.end()

    expect(gameState.isRoguelike1v1).toBe(false)
    expect(gameState.needShowName).toBe(false)
    gameState.updateRecordInfo({ gameId, matchName: '单骑无双' })
    expect(gameState.isGameStart).toBe(false)
    expect(gameState.isRoguelike1v1).toBe(true)
    gameState.beginPlayback()
    expect(gameState.isGameStart).toBe(true)
  })

  it('缺少 gameId 的旧数据也由座位消息重置新一轮播放', () => {
    const { controller, gameState } = createTrackerControllerHarness()
    gameState.updateRecordInfo({ matchName: '斗地主' })
    expect(gameState.isGameStart).toBe(false)
    controller.initTrackerRoom()
    gameState.setTurn(2)
    gameState.updateRecordInfo({ matchName: '斗地主' })

    expect(gameState.isGameStart).toBe(true)
    expect(gameState.turn).toBe(2)
    expect(gameState.isDouDiZhu).toBe(true)

    controller.initTrackerRoom()
    expect(gameState.turn).toBe(0)
    expect(gameState.isDouDiZhu).toBe(true)
  })

  it.each([
    ['斗地主', true, false, false, true],
    ['新欢乐排位', false, false, false, true],
    ['cmk排位', false, false, false, true],
    ['单骑无双', false, true, false, true],
    ['长安行[20610702]', false, false, true, false],
    ['山河图', false, false, true, false],
    ['身份演武军争', false, false, false, false]
  ] as const)(
    '%s 保留既有模式识别',
    (matchName, isDouDiZhu, isRoguelike1v1, isShanHeTu, needShowName) => {
      const gameState = new GameState()
      gameState.updateRecordInfo({ gameId, matchName: '单骑无双' })
      gameState.updateRecordInfo({ gameId: { ...gameId, low: 1 }, matchName })

      expect(gameState).toMatchObject({ isDouDiZhu, isRoguelike1v1, isShanHeTu, needShowName })
    }
  )
})
