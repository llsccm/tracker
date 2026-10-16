import type { MoveEventHandler } from '../room/moveEvents'
import { POSITION_RANDOM } from '../candidate/cardPositions'
import type { Room } from '../Room'
import { decorateChengLieMove } from '../skill/ChengLie'
import decorateFenChao from '../skill/FenChao'
import decorateGuanXu from '../skill/GuanXu'
import decorateHandExchange from '../skill/HandExchange'
import decorateJieLi from '../skill/JieLi'
import decorateXingZuo from '../skill/XingZuo'
import decorateSiQi from '../skill/SiQi'
import decorateTianHou from '../skill/TianHou'
import decorateZuoLian from '../skill/ZuoLian'
import decorateYanXi from '../skill/YanXi'
import { decorateWenGuaCandidateSource } from '../skill/WenGua'
import {
  getCount,
  hasPositiveID,
  nextGroupID,
  patchEvent,
  type MoveEventDraft,
  getSourceZoneCards
} from '../skill/moveEventUtils'
import {
  decorateDuoQiEntitySafety,
  decorateDuoQiKnownMove,
  decorateDuoQiMove
} from '../skill/DuoQi'

export type { MoveEventHandler } from '../room/moveEvents'

const HAND_EXCHANGE_EXCLUDED_SPELL_IDS: ReadonlySet<number> = new Set([
  3208, // 骋烈
  3483, // 诫厉
  3903, // 天候
  3776, // 兴作
  987, // 观虚
  988 // 观虚
])

export function decorateGenericMove(event: MoveEventDraft, room: Room): MoveEventDraft {
  const move = event.protocol
  const spellID = move.SpellID

  // observePendingChengLieFinalDiscard(event, room)

  // 牌堆与手牌交换有技能专属批次，不能落入双方整手交换账本。
  if (HAND_EXCHANGE_EXCLUDED_SPELL_IDS.has(spellID)) return event

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
    const move = event.protocol
    const fromZone = move.FromZone

    if (
      hasPositiveID(event.cardIDs) ||
      ![1, 2].includes(fromZone) ||
      move.FromPosition !== POSITION_RANDOM
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
  // 夺炁 初始牌身份标记
  room.registerMoveEventHandler('*', decorateDuoQiEntitySafety)
  room.registerMoveEventHandler('*', decorateDuoQiKnownMove)

  // 黄承彦【观虚】：按 FromID/ToID 保留牌堆侧与手牌侧交换桶。
  room.registerMoveEventHandler(987, decorateGuanXu)
  room.registerMoveEventHandler(988, decorateGuanXu)

  // 周群【天候】：其他视角的匿名换牌批次及最终单牌范围揭示。
  room.registerMoveEventHandler(3903, decorateTianHou)

  //【兴作】：牌底与手牌整批交换，保留牌底已有的明牌。
  room.registerMoveEventHandler(3776, decorateXingZuo)

  //【思泣】：协议不公开返回牌 ID，按弃牌堆顺序筛选红牌实体作为明确来源。
  room.registerMoveEventHandler(3543, decorateSiQi)

  //【焚巢】：从弃牌堆暗取时，优先最早入堆的杀、决斗、南蛮、万箭和火攻。
  room.registerMoveEventHandler(3752, decorateFenChao)

  // 魔吕布【夺炁】： 3730/3731 获取修正。
  room.registerMoveEventHandler(3730, decorateDuoQiMove)
  room.registerMoveEventHandler(3731, decorateDuoQiMove)

  // 马承【骋烈】
  room.registerMoveEventHandler(3208, decorateChengLieMove)

  // 族钟繇【诫厉】：目标视角定位换出槽位，第三方视角保留手牌/牌顶范围弱候选。
  room.registerMoveEventHandler(3483, decorateJieLi)

  // 徐氏【问卦】：相邻的主动交牌/回堆消息只筛选候选来源，不追踪单个实体。
  room.registerMoveEventHandler(780, decorateWenGuaCandidateSource)

  // 蒲元【奇思】：优先筛选装备牌候选。
  // room.registerMoveEventHandler(
  //   11104,
  //   createFilteredPublicMoveHandler(11104, 'qisi_candidate', (card) => card.type === 3)
  // )

  // 蔡瑁【佐练】：仅在弃牌堆随机取牌时，优先最后入堆的火杀，其次雷杀。
  room.registerMoveEventHandler(3488, decorateZuoLian)
  // 宴戏
  room.registerMoveEventHandler(7017, decorateYanXi)

  // 樊稠【兴乱】：优先筛选点数为 6 的候选。
  room.registerMoveEventHandler(
    862,
    createFilteredPublicMoveHandler(862, 'xingluan_candidate', (card) => card.number === 6)
  )
}
