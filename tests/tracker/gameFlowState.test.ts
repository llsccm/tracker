import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getReadyTrackerRoom, setTrackerMySeatID } = vi.hoisted(() => ({
  getReadyTrackerRoom: vi.fn(),
  setTrackerMySeatID: vi.fn()
}))

vi.mock('../../src/tracker/runtime/browser', () => ({
  tracker: {
    getReadyTrackerRoom,
    setTrackerMySeatID
  }
}))

vi.mock('../../src/config', () => ({
  CardConfig: {
    GetInstance: () => ({
      getCard: () => undefined
    })
  }
}))

import { handleGameFlowState } from '../../src/handler/gameFlowState'

function createRecordGame() {
  const room = {
    mySeatID: undefined as number | undefined
  }

  const game = {
    isRecord: true,
    isGameStart: true,
    isPassed: false,
    myID: undefined as number | undefined,
    room,
    record: vi.fn()
  }

  return { game, room }
}

function createDrawContext(game, overrides = {}) {
  return {
    game,
    CardIDs: [101, 102, 103, 104],
    CardCount: 4,
    FromID: 255,
    FromZone: 1,
    FromPosition: 0,
    ToID: 3,
    ToZone: 5,
    MoveType: 1,
    SpellID: 0,
    ...overrides
  }
}

describe('handleGameFlowState 录像主视角', () => {
  beforeEach(() => {
    getReadyTrackerRoom.mockReset()
    getReadyTrackerRoom.mockReturnValue(null)
    setTrackerMySeatID.mockReset()
  })

  it('将首次从牌堆摸明牌的座位设为主视角', () => {
    const { game } = createRecordGame()

    handleGameFlowState(createDrawContext(game))

    expect(setTrackerMySeatID).toHaveBeenCalledOnce()
    expect(setTrackerMySeatID).toHaveBeenCalledWith(3)
  })

  it('主视角确定后不再随后续明牌摸牌变化', () => {
    const { game, room } = createRecordGame()

    handleGameFlowState(createDrawContext(game))
    room.mySeatID = 3
    handleGameFlowState(createDrawContext(game, { ToID: 5, CardIDs: [105, 106, 107, 108] }))

    expect(setTrackerMySeatID).toHaveBeenCalledOnce()
    expect(setTrackerMySeatID).toHaveBeenCalledWith(3)
  })

  it('首次摸到暗牌时不确定主视角', () => {
    const { game, room } = createRecordGame()

    handleGameFlowState(createDrawContext(game, { CardIDs: [0, 0, 0, 0] }))

    expect(setTrackerMySeatID).not.toHaveBeenCalled()
    expect(room.mySeatID).toBeUndefined()
  })
})
