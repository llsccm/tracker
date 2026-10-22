import { CardConfig } from '@/config'
import { laya } from '@/runtime/gameAdapter'
import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { setSuitRecord } from '@/utils'

/**
 * @param {object} msg - PubGsCUseSpell
 */
export function handleUseSpell(msg) {
  const { SeatID, SpellID, CardIDs = [] } = msg

  // 此处是技能消耗的卡牌 不能视为使用
  // if (Game.myID === SeatID && CardIDs.length === 1) {
  //   drawLastUseCard(CardIDs)
  // }

  tracker.dispatchSkillProtocolEvent({ type: 'useSpell', message: msg })

  switch (SpellID) {
    // 博图计数器
    case 3090:
      if (SeatID === Game.currentID && msg.EffectIndex === 1) {
        const prev = Game.getSpellState(3090) ?? 0
        Game.setSpellState(3090, prev + 1)
        // laya.ged?.event('SET_SEAT_STATE')
      }
      break

    // 国战乱击
    case 2143: {
      const suits = Game.ensureSpellState(2143, () => new Set())

      const instance = CardConfig.GetInstance()
      for (const id of CardIDs) {
        if (id <= 0) continue
        suits.add(instance.getCard(id).c)
      }

      setSuitRecord(Array.from(suits).join(''))
      break
    }

    case 3193: // 贵相
    case 3185: // 持纲
    case 3138: // 持纲(旧)
    case 3161: // 醇醪(界)
      Game.phase--
      break

    case 13027:
    case 13028:
    case 13029: // 当头一棒
    case 13039:
    case 13040:
    case 13041: // 淬血
    case 13087:
    case 13088:
    case 13089: // 雷火势
    case 13184:
    case 13185: // 厚实
    case 13293:
    case 13294: // 削命 谋命
      if (SeatID === Game.myID) {
        laya.zhanfaCounter(SpellID)
      }

      break

    default:
      break
  }
}
