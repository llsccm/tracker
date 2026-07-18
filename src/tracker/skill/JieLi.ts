import { POSITION_BOTTOM, POSITION_TOP, POSITION_RANDOM } from '../candidate/cardPositions'
import type { MoveEventDraft } from '../runtime/moveEventHandlers'
import {
  getRaw,
  hasPositiveID,
  patchEvent,
  getTopFirstCards,
  nextGroupID,
  getEventSourceCards,
  createSourcePatch,
  getCount
} from '../runtime/moveEventHandlers'
import type { Room } from '../Room'

// 族钟繇【诫厉】：历史装饰器，当前不要挂到主动路径。
// 已观测实战与下列假设不一致：
// 1) 观看 top-first（如 [81,99,124,4]，81 为顶）后，交换 CardIDs 可能整段逆序（[4,124,99,81]）
// 2) 回出是 10->1 与 10->5 拆分，且回牌堆可能混入手牌来源，不是“暂存手牌整批全暗回牌堆”
// 协议见 docs/protocols/GsCRoleOptTargetNtf-3483.md
export default function decorateJieLi(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  const cardIDs = event.cardIDs ?? []
  const fromZone = Number(raw.FromZone)
  const toZone = Number(raw.ToZone)
  const allDark = !hasPositiveID(cardIDs)
  const state = room.getSkillState(3483)

  // 交换区内部调整：旧逻辑在全暗时按底部取、顶部放。
  if (fromZone === 10 && toZone === 10 && allDark) {
    return patchEvent(event, {
      options: {
        fromPosition: POSITION_BOTTOM,
        position: POSITION_TOP
      }
    })
  }

  // 牌堆进入交换区：若操作通知给出期望数量，先把牌堆相关候选折成局部分组。
  if (fromZone === 1 && toZone === 10 && Number(raw.FromPosition) === POSITION_RANDOM) {
    if (state.expectedPileCount > 0) {
      const groupedCards = getTopFirstCards(room.zones.get('pile')?.cards ?? []).slice(
        0,
        state.expectedPileCount
      )

      if (groupedCards.length > 0) {
        room.createConstraintGroup({
          id: nextGroupID(room, 3483, 'jieli_pile'),
          cards: groupedCards,
          sourceEvent: event.options?.sourceEvent
        })
      }
    }

    if (allDark) {
      return patchEvent(event, { options: { fromPosition: POSITION_BOTTOM } })
    }
  }

  // 手牌进入交换区：记录这批暂存 Card，等待后续从交换区回牌堆时复用。
  if (fromZone === 5 && toZone === 10) {
    const stagedCards = getEventSourceCards(event, room)
    state.stagedCards = stagedCards
    state.stagedCardIDs = stagedCards.map((card) => card.id).filter((id) => id > 0)

    return patchEvent(event, {
      options: {
        ...createSourcePatch(event, stagedCards),
        combinationID: nextGroupID(room, 3483, 'jieli_stage')
      }
    })
  }

  // 交换区回牌堆：协议若仍是全暗，用前面记录的暂存实体补齐 CardIDs 和 sourceCards。
  if (fromZone === 10 && toZone === 1 && Number(raw.FromPosition) === POSITION_RANDOM) {
    const stagedCards = (state.stagedCards ?? []).filter((card) => card.location === 'exchange')

    if (allDark && stagedCards.length === getCount(event)) {
      room.clearSkillState(3483)
      return patchEvent(event, {
        cardIDs: stagedCards.map((card) => card.id || 0),
        options: {
          sourceCards: stagedCards,
          combinationID: nextGroupID(room, 3483, 'jieli_return')
        }
      })
    }

    room.clearSkillState(3483)
  }

  return event
}
