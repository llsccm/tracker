import { POSITION_RANDOM } from '../candidate/cardPositions'
import type { Room } from '../Room'
import decorateGuanXu, { isGuanXuSpellID } from '../skill/GuanXu'
import decorateHandExchange from '../skill/HandExchange'
import decorateSiQi from '../skill/SiQi'
import decorateTianHou from '../skill/TianHou'
import {
  getRaw,
  getCount,
  hasPositiveID,
  nextGroupID,
  patchEvent,
  type MoveEventDraft,
  getSourceZoneCards
} from '../skill/moveEventUtils'
import decorateWenGua from '../skill/WenGua'
import {
  decorateDuoQiEntitySafety,
  decorateDuoQiKnownMove,
  decorateDuoQiMove
} from '../skill/DuoQi'

export type MoveEventHandler = (event: MoveEventDraft, room: Room) => MoveEventDraft

export function decorateGenericMove(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  const spellID = Number(raw.SpellID ?? event.options?.spellID)

  // 浑天仪：协议上是外部牌随机压入牌堆，显式标记来源为 outside。
  if (
    spellID === 3694 &&
    Number(raw.FromZone) === 0 &&
    Number(raw.ToZone) === 1 &&
    Number(raw.MoveType) === 19
  ) {
    return patchEvent(event, {
      options: {
        fromZone: 'outside',
        position: POSITION_RANDOM
      }
    })
  }

  // 手气卡：手牌放回牌堆时，用 ConstraintGroup 保留同次返回关系，替代旧 pack(to.cards)。
  if (
    Number(raw.FromZone) === 5 &&
    Number(raw.ToZone) === 1 &&
    spellID === 0 &&
    Number(raw.MoveType) === 19
  ) {
    return patchEvent(event, {
      options: {
        // 实测会重新混入牌堆；本地匿名槽顺序只是代表顺序，不是牌顶事实。
        position: POSITION_RANDOM,
        // 手气卡返还的明牌重新进入牌堆后，应恢复为未知牌身份。
        resetKnownToUnknown: true
      }
    })
  }

  // observePendingChengLieFinalDiscard(event, room)

  // 天候的部分手牌交换需要同时区分牌堆批次与手牌批次，不能落入整手交换账本。
  if (spellID === 3903 || isGuanXuSpellID(spellID)) return event

  // 整手牌经交换区互易：按协议模式处理，不绑定单一 SpellID。
  return decorateHandExchange(event, room)
}

// 奇思 / 佐练 / 兴乱：旧 Zone.remove 会按技能条件从随机公共区优先挑候选牌。
function createFilteredPublicMoveHandler(
  spellID: number,
  label: string,
  predicate: (card: any) => boolean
): MoveEventHandler {
  return (event, room) => {
    const raw = getRaw(event)
    const fromZone = Number(raw.FromZone)

    if (
      hasPositiveID(event.cardIDs) ||
      ![1, 2].includes(fromZone) ||
      Number(raw.FromPosition) !== POSITION_RANDOM
    ) {
      return event
    }

    const selectedCards: any[] = []
    const count = getCount(event)
    const sourceCards = getSourceZoneCards(event, room)

    for (let index = sourceCards.length - 1; index >= 0 && selectedCards.length < count; index--) {
      const card = sourceCards[index]
      if (predicate(card)) {
        selectedCards.push(card)
      }
    }

    if (selectedCards.length === 0) return event

    return patchEvent(event, {
      options: {
        sourceCards: selectedCards,
        combinationID: nextGroupID(room, spellID, label)
      }
    })
  }
}

export function registerDefaultMoveEventHandlers(room: Room): void {
  room.registerMoveEventHandler('*', decorateGenericMove)
  room.registerMoveEventHandler('*', decorateDuoQiEntitySafety)
  room.registerMoveEventHandler('*', decorateDuoQiKnownMove)
  // 黄承彦【观虚】：按 FromID/ToID 保留牌堆侧与手牌侧交换桶。
  room.registerMoveEventHandler(987, decorateGuanXu)
  room.registerMoveEventHandler(988, decorateGuanXu)
  // 周群【天候】：其他视角的匿名换牌批次及最终单牌范围揭示。
  room.registerMoveEventHandler(3903, decorateTianHou)
  //【思泣】：协议不公开返回牌 ID，按弃牌堆顺序筛选红牌实体作为明确来源。
  room.registerMoveEventHandler(3543, decorateSiQi)
  // 魔吕布【夺炁】：初始牌身份标记与 3730/3731 获取修正。
  room.registerMoveEventHandler(3730, decorateDuoQiMove)
  room.registerMoveEventHandler(3731, decorateDuoQiMove)
  // 马承【骋烈】
  // room.registerMoveEventHandler(3208, decorateChengLie)
  // 族钟繇【诫厉】
  // room.registerMoveEventHandler(3483, decorateJieLi)
  // 徐氏【问卦】
  room.registerMoveEventHandler(780, decorateWenGua)
  // 蒲元【奇思】：优先筛选装备牌候选。
  room.registerMoveEventHandler(
    11104,
    createFilteredPublicMoveHandler(11104, 'qisi_candidate', (card) => card.type === 3)
  )
  // 蔡瑁【佐练】：优先筛选属性杀候选。
  // room.registerMoveEventHandler(
  //   3488,
  //   createFilteredPublicMoveHandler(3488, 'zuolian_candidate', (card) =>
  //     ['雷杀', '火杀', '冰杀'].includes(card.name)
  //   )
  // )
  // 樊稠【兴乱】：优先筛选点数为 6 的候选。
  room.registerMoveEventHandler(
    862,
    createFilteredPublicMoveHandler(862, 'xingluan_candidate', (card) => card.number === 6)
  )
}
