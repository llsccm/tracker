import { SpellExtendConfig } from '@/config'
import { Game, globalConfig } from '@/tracker'
import { GUI_FU_ROLE_DATA_ID } from '@/tracker/runtime/protocolRules'
import { recordDuoQiRoleDataTarget } from '@/tracker/skill/DuoQi'
import { renderPeiXiuMapWindow, setPeiXiuMapWindowVisible } from '@/ui/PeiXiuMapWindow'
import { getRenderedPeiXiuHandSuitColors } from '@/ui/PeiXiuHandMirror'
import { parsePeiXiuRoleData, solvePeiXiuRoleData } from '@/utils/peixiuRouteFeature'
import { handleQiaoZhi } from './skills/QiaoZhi'
import { handleGuiFu } from './skills/GuiFu'
import { laya } from '@/runtime/gameAdapter'

// GsCUpdateRoleDataExNtf
export function handleUpdateRoleDataExNtf(msg) {
  const { Datas, SeatID, DataID } = msg
  switch (DataID) {
    // OPT_DATA_ADD_SPELL_EFFECT
    case 8:
      // 夺炁：SeatID 是目标，Datas=[SpellID, 技能拥有者座位]。
      recordDuoQiRoleDataTarget(Game, msg)
      break

    //出杀次数
    case 1:
      if (Game.currentID == SeatID && Array.isArray(Datas)) {
        const shaElement = document.getElementById('sha')
        if (shaElement) {
          shaElement.innerText = '剩余：' + Math.max(0, Datas[2] - Datas[1])
        }
      }
      break

    // OPT_DATA_ADD_NEW_SPELL 可用于注册战法 目前没用
    case 15:
      if (!Array.isArray(Datas)) break
      if (SeatID !== undefined && SeatID == Game.myID) {
        // isReverse 好像没什么用
        const isSpecial = Datas[3] > 0
        // const speicalData = isSpecial ? [msg.Datas[3]] : []

        const generalId = Datas[0]
        const skillCnt = Datas[1]

        // 截取索引 2 开始的数据；若 isSpecial 为 true，则排除原索引 3 的元素
        const remaining = isSpecial ? [...Datas.slice(2, 3), ...Datas.slice(4)] : Datas.slice(2)

        const skillIds = remaining.slice(0, skillCnt)

        if (generalId === 0 && Game.isShanHeTu) {
          // console.info('战法技能id: ', skillIds)
          for (const skillId of skillIds) {
            Game.zhanfaSet.add(skillId)
          }
        }

        // 获得新技能得重建缓存
        if (Game.turn >= 1 && (Game.isShanHeTu || Game.isRoguelike1v1)) {
          setTimeout(() => {
            laya.zhanfaRegister()
          }, 0)
        }
      }

      break

    case 16:
      if (!Array.isArray(Datas)) break
      if (SeatID !== undefined && SeatID == Game.myID) {
        if (Game.turn >= 1 && (Game.isShanHeTu || Game.isRoguelike1v1)) {
          setTimeout(() => {
            laya.zhanfaRegister()
          }, 0)
        }
      }
      break

    // OPT_DATA_UPDATE_NEW_SPELL
    case 17:
      if (!Array.isArray(Datas)) break
      if (SeatID !== undefined && SeatID == Game.myID && import.meta.env.DEV) {
        console.info(msg)
      }
      break

    // 巧织 获得的牌
    case 3544:
      // 其他视角的移动协议只有暗牌数量，3544 通知补充实际 CardID；主视角已从移动协议获知。
      handleQiaoZhi(msg, Game.myID)
      break

    // 诡伏：非主视角先收到匿名移动，角色数据随后补充实际牌面。
    case GUI_FU_ROLE_DATA_ID:
      handleGuiFu(msg, Game.myID)
      break

    // 郭照 椒遇 选择的颜色
    case 3571:
      // Datas:[x] 1红2黑
      if (Array.isArray(Datas)) {
        const colors = Datas[0] == 1 ? [1, 2] : [3, 4]
        Game.setSpellState(3571, new Set(colors))
      }
      break

    // 尽览
    case 4022:
      if (Array.isArray(Datas)) {
        const roleData = parsePeiXiuRoleData(Datas)
        if (!roleData) break

        const spellExtendConfig = SpellExtendConfig.GetInstance()
        const mapConfig = spellExtendConfig.PeiXiuCellDic.get(roleData.mapId)
        const solvedState = mapConfig ? solvePeiXiuRoleData(mapConfig, Datas) : null
        const presetRoutes = spellExtendConfig.PeiXiuPresetRoutes.get(roleData.mapId) || []
        const usesMainHandMirror =
          Game.myID != null && SeatID != null && Number(Game.myID) === Number(SeatID)
        const handSuitColors = usesMainHandMirror ? getRenderedPeiXiuHandSuitColors() : null

        const state = solvedState
          ? { ...solvedState, presetRoutes, handSuitColors, usesMainHandMirror }
          : {
              ...roleData,
              result: null,
              presetRoutes,
              handSuitColors,
              usesMainHandMirror
            }

        Game.setSpellState(4022, state)

        if (state.result) {
          renderPeiXiuMapWindow(state, spellExtendConfig.PeiXiuBonus)
          setPeiXiuMapWindowVisible(Boolean(globalConfig.peiXiuMapSwitch))
        }
      }

      break

    // 化刃
    case 7128:
      // 此时获得一个技能 山河图需要刷新战法缓存
      // Datas: [1, 1, 1513, 1, 20334, 1]
      if (!Array.isArray(Datas)) break
      if (SeatID !== undefined && SeatID !== Game.myID) return
      if (Game.isShanHeTu || Game.isRoguelike1v1) {
        setTimeout(() => {
          laya.zhanfaRegister()
        }, 0)
      }

      break
    default:
      break
  }
}
