import { CardConfig } from '@/config'
import { drawCard } from '@/draw'
import { laya } from '@/runtime/gameAdapter'
import { Game } from '@/tracker'
// import { laya } from '@/runtime/gameAdapter'
import { setSuitRecord } from '@/utils'

/**
 * @param {object} msg - PubGsCUseSpell
 */
export function handleUseSpell(msg) {
  const { SeatID, SrcSeatID, SpellID, CardIDs = [] } = msg

  if (Game.myID === SeatID && CardIDs.length === 1) {
    drawCard(CardIDs)
  }

  switch (SpellID) {
    // 博图计数器
    case 3090:
      if (SeatID === Game.currentID && msg.EffectIndex === 1) {
        const prev = Number(Game.spellSpace[3090]) || 0
        Game.spellSpace[3090] = prev + 1
        // laya.ged?.event('SET_SEAT_STATE')
      }
      break

    // 国战乱击
    case 2143: {
      if (!Game.spellSpace[2143]) {
        Game.spellSpace[2143] = new Set()
      }

      const instance = CardConfig.GetInstance()
      for (const id of CardIDs) {
        if (id <= 0) continue
        Game.spellSpace[2143].add(instance.getCard(id).c)
      }

      setSuitRecord(Array.from(Game.spellSpace[2143]).join(''))
      break
    }

    case 3157: // 夏侯玄-清议
    case 3511: // 李婉-联句
      if ((SrcSeatID === Game.myID || import.meta.env.DEV) && CardIDs.some((id) => id > 0)) {
        Game.setSpellState(SpellID, CardIDs)
      }
      break

    case 3193: // 贵相
    case 3185: // 持纲
    case 3138: // 持纲(旧)
    case 3161: // 醇醪(界)
      Game.phase--
      break

    case 3571:
      // 郭照 椒遇 现在会进入处理区 无需再创建空间存储
      // if (msg.EffectIndex === 1) {
      //   Game.setSpellState(3571, new Set())
      // }
      break

    // 谋许攸 迁附 控顶
    case 3750:
      if (msg.EffectIndex === 2 && !msg.DestSeatIDs?.length) {
        Game.setSpellState(3750, CardIDs)
      }
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
