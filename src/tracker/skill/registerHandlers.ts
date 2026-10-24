import type { Room } from '../Room'
import { decorateChengLieMove } from './ChengLie'
import decorateFenChao from './FenChao'
import decorateGuanXu from './GuanXu'
import decorateHandExchange from './HandExchange'
import { jieLiPlugin } from './JieLi'
import decorateXingZuo from './XingZuo'
import decorateSiQi from './SiQi'
import decorateTianHou from './TianHou'
import decorateZuoLian, { prepareZuoLianMove } from './ZuoLian'
import decorateYanXi from './YanXi'
import { decorateWenGuaCandidateSource } from './WenGua'
import type { MoveEventDraft } from './moveEventUtils'
import {
  commitDuoQiMove,
  decorateDuoQiEntitySafety,
  decorateDuoQiKnownMove,
  decorateDuoQiMove,
  initializeDuoQiState,
  observeDuoQiKnownCardIDs,
  recordDuoQiActivation,
  recordDuoQiRoleDataTarget
} from './DuoQi'
import { guiFuPlugin } from './GuiFu'
import { xiaShuPlugin } from './XiaShu'
import { qingYiLianJuPlugin } from './QingYiLianJu'
import { qianFuPlugin } from './QianFu'
import { shengMoPlugin } from './ShengMo'
import { zeXingPlugin } from './ZeXing'

export type { MoveEventHandler } from '../room/index'

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

export function registerDefaultMoveEventHandlers(room: Room): void {
  // 诡伏
  room.registerSkillPlugin(guiFuPlugin)

  // 手牌交换
  room.registerSkillPlugin({ id: 'genericMove', decorateMove: decorateGenericMove })

  // 夺炁 初始牌身份标记
  room.registerSkillPlugin({ id: 'duoQiEntitySafety', decorateMove: decorateDuoQiEntitySafety })
  room.registerSkillPlugin({
    id: 'duoQi',
    decorateMove: decorateDuoQiKnownMove,
    afterMoveCommitted(event, currentRoom) {
      if (
        !['showCards', 'revealPublicCandidate', 'shuffleDiscardIntoPile', 'noop'].includes(
          event.type
        )
      ) {
        commitDuoQiMove(currentRoom, event)
      }
    },
    onCardsRevealed: (ids, currentRoom) => observeDuoQiKnownCardIDs(currentRoom, ids),
    onProtocolEvent(event, currentRoom) {
      if (event.type === 'useSpell') recordDuoQiActivation(currentRoom.game, event.message)

      // 狂魔状态
      if (
        event.type === 'roleData' &&
        event.message.DataID === 8 &&
        event.message.Datas?.[0] === 3730
      ) {
        recordDuoQiRoleDataTarget(currentRoom.game, event.message)
      }

      if (event.type === 'choice' && event.message.Type === 72 && event.message.Datas?.length) {
        const game = currentRoom.game
        if (game.isGameStart && !game.round && !game.phase) {
          initializeDuoQiState(game, event.message.Datas)
        }
      }
    },
    onDeckInitialized: (currentRoom) => currentRoom.deleteSkillState('duoQi')
  })

  // 黄承彦【观虚】：按 FromID/ToID 保留牌堆侧与手牌侧交换桶。
  room.registerSkillPlugin({ id: 'guanXu', spellIDs: [987, 988], decorateMove: decorateGuanXu })

  // 周群【天候】：其他视角的匿名换牌批次及最终单牌范围揭示。
  room.registerSkillPlugin({ id: 'tianHou', spellIDs: [3903], decorateMove: decorateTianHou })

  //【兴作】：牌底与手牌整批交换，保留牌底已有的明牌。
  room.registerSkillPlugin({ id: 'xingZuo', spellIDs: [3776], decorateMove: decorateXingZuo })

  //【思泣】：协议不公开返回牌 ID，按弃牌堆顺序筛选红牌实体作为明确来源。
  room.registerSkillPlugin({ id: 'siQi', spellIDs: [3543], decorateMove: decorateSiQi })

  //【焚巢】：从弃牌堆暗取时，优先最早入堆的杀、决斗、南蛮、万箭和火攻。
  room.registerSkillPlugin({ id: 'fenChao', spellIDs: [3752], decorateMove: decorateFenChao })

  // 魔吕布【夺炁】： 3730/3731 获取修正。
  room.registerSkillPlugin({
    id: 'duoQiMove',
    spellIDs: [3730, 3731],
    decorateMove: decorateDuoQiMove
  })

  // 马承【骋烈】
  room.registerSkillPlugin({ id: 'chengLie', spellIDs: [3208], decorateMove: decorateChengLieMove })

  // 族钟繇【诫厉】：目标视角定位换出槽位，第三方视角保留手牌/牌顶范围弱候选。
  room.registerSkillPlugin(jieLiPlugin)

  // 徐氏【问卦】：相邻的主动交牌/回堆消息只筛选候选来源，不追踪单个实体。
  room.registerSkillPlugin({
    id: 'wenGua',
    spellIDs: [780],
    decorateMove: decorateWenGuaCandidateSource
  })

  // 蔡瑁【佐练】：仅在弃牌堆随机取牌时，优先最后入堆的火杀，其次雷杀。
  room.registerSkillPlugin({
    id: 'zuoLian',
    spellIDs: [3488],
    beforeNormalizeMove: (patched, raw, currentRoom) => prepareZuoLianMove(patched, currentRoom),
    decorateMove: decorateZuoLian,
    onDeckInitialized: (currentRoom) => currentRoom.deleteSkillState(3488)
  })
  // 宴戏
  room.registerSkillPlugin({ id: 'yanXi', spellIDs: [7017], decorateMove: decorateYanXi })
  // 清议连句
  room.registerSkillPlugin(qingYiLianJuPlugin)
  // 迁附
  room.registerSkillPlugin(qianFuPlugin)
  // 剩墨
  room.registerSkillPlugin(shengMoPlugin)
  // 择行
  room.registerSkillPlugin(zeXingPlugin)
  // 下书
  room.registerSkillPlugin(xiaShuPlugin)
}
