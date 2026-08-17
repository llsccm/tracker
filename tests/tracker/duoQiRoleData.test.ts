import { afterEach, describe, expect, it } from 'vitest'
import { handleUpdateRoleDataExNtf } from '@/handler/GsCUpdateRoleDataExNtf'
import { Game } from '@/tracker'
import { Room } from '@/tracker/Room'
import { getDuoQiState, initializeDuoQiState, recordDuoQiActivation } from '@/tracker/skill/DuoQi'

describe('GsCUpdateRoleDataExNtf 夺炁目标', () => {
  afterEach(() => {
    Game.room?.destroy()
    Game.bindRoom(null)
  })

  it('DataID=8 用 SeatID 和 Datas 更新 3730 目标及技能拥有者', () => {
    const room = new Room({ gameState: Game })
    room.registerPlayers(
      [
        { SeatID: 2, ClientID: 200 },
        { SeatID: 3, ClientID: 300 },
        { SeatID: 4, ClientID: 400 }
      ],
      200
    )
    room.initDeck([1, 2, 3])
    initializeDuoQiState(Game, [1, 2, 3])
    expect(
      recordDuoQiActivation(Game, {
        SpellID: 3730,
        EffectIndex: 1,
        SkillOwerSeatID: 4,
        DestSeatIDs: [3]
      })
    ).toBeUndefined()
    expect(getDuoQiState(room)?.activations.has(3730)).toBe(false)

    handleUpdateRoleDataExNtf({
      className: 'GsCUpdateRoleDataExNtf',
      DataID: 8,
      Datas: [3730, 4],
      IsSpell: false,
      SeatID: 2
    })

    expect(getDuoQiState(room)?.activations.get(3730)).toMatchObject({
      ownerSeatID: 4,
      targetSeatID: 2,
      effectIndex: 1
    })
  })
})
