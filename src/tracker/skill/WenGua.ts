import { POSITION_RANDOM } from '../candidate/cardPositions'
import type { Room } from '../Room'

import {
  getRaw,
  hasPositiveID,
  getCount,
  patchEvent,
  nextGroupID,
  type MoveEventDraft,
  getEventSourceCards,
  createSourcePatch
} from './moveEventUtils'

// 徐氏【问卦】：追踪当前回合被问卦移动的一张牌，后续他人放回牌堆时复用该实体。
export default function decorateWenGua(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  const fromZone = Number(raw.FromZone)
  const toZone = Number(raw.ToZone)

  if (fromZone !== 5 || Number(raw.FromPosition) !== POSITION_RANDOM || getCount(event) !== 1) {
    return event
  }

  const state = room.getSkillState(780)
  const currentSeatID = room?.game?.currentID

  // 当前角色获得问卦牌：记录实体，后续判断是否被其他角色放回牌堆。
  if (toZone === 5 && Number(raw.FromID) === Number(currentSeatID)) {
    const sourceCards = getEventSourceCards(event, room)
    state.trackedCard = sourceCards[0] ?? null

    return patchEvent(event, {
      options: {
        ...createSourcePatch(event, sourceCards),
        combinationID: nextGroupID(room, 780, 'wengua_track')
      }
    })
  }

  // 他人把被追踪的问卦牌放回牌堆：全暗事件也能补上真实 ID。
  const trackedCard = state.trackedCard
  if (
    toZone === 1 &&
    Number(raw.FromID) !== Number(currentSeatID) &&
    trackedCard &&
    trackedCard.location === 'player' &&
    trackedCard.seats.has(Number(raw.FromID))
  ) {
    room.clearSkillState(780)
    return patchEvent(event, {
      cardIDs: hasPositiveID(event.cardIDs) ? event.cardIDs : [trackedCard.id || 0],
      options: {
        sourceCards: [trackedCard],
        combinationID: nextGroupID(room, 780, 'wengua_return')
      }
    })
  }

  return event
}
