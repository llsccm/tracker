import { CardConfig, SpellExtendConfig } from '@/config'
import { Game, globalConfig } from '@/tracker'
import {
  getRenderedMainHandCardIDs,
  subscribeRenderedMainHandCardIDs
} from '@/tracker/view/PlayerHandView'
import { renderPeiXiuMapWindow, setPeiXiuMapWindowVisible } from '@/ui/PeiXiuMapWindow'
import { parsePeiXiuRoleData, solvePeiXiuRoleData } from '@/utils/peixiuRouteFeature'
import { handleQiaoZhi } from './skills/QiaoZhi'

// GsCUpdateRoleDataExNtf
export function handleUpdateRoleDataExNtf(msg) {
  const { Datas, SeatID, DataID } = msg
  switch (DataID) {
    //出杀次数
    case 1:
      if (Game.currentID == SeatID && Array.isArray(Datas)) {
        document.getElementById('sha').innerText = '剩余：' + Math.max(0, Datas[2] - Datas[1])
      }
      break

    // OPT_DATA_ADD_NEW_SPELL 可用于注册战法
    case 15:
      if (!Array.isArray(Datas)) break
      if (SeatID !== undefined && SeatID == Game.myID && import.meta.env.DEV) {
        // isReverse
        const isSpecial = Datas[3] > 0
        // const speicalData = isSpecial ? [msg.Datas[3]] : []

        const generalId = Datas[0]
        const skillCnt = Datas[1]

        // 截取索引 2 开始的数据；若 isSpecial 为 true，则排除原索引 3 的元素
        const remaining = isSpecial ? [...Datas.slice(2, 3), ...Datas.slice(4)] : Datas.slice(2)

        const skillIds = remaining.slice(0, skillCnt)

        if (generalId === 0 && Game.isShanHeTu) {
          console.info('战法技能id: ', skillIds)
        }
      }

      break

    // 巧织 获得的牌
    case 3544:
      // 其他视角的移动协议只有暗牌数量，3544 通知补充实际 CardID；主视角已从移动协议获知。
      handleQiaoZhi(msg, Game.myID)
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
        const handSuitColors = usesMainHandMirror ? getRenderedHandSuitColors() : null

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

    default:
      break
  }
}

/**
 * @returns {number[]|null}
 */
function getRenderedHandSuitColors() {
  const cardIDs = getRenderedMainHandCardIDs()
  if (cardIDs === null) return null

  const cardConfig = CardConfig.GetInstance()
  return cardIDs
    .map((id) => Number(cardConfig.getCardColor(id)))
    .filter((color) => color >= 1 && color <= 4)
}

function refreshPeiXiuHandSuitColors() {
  const state = Game.getSpellState(4022)
  if (!state?.usesMainHandMirror || !state.result) return

  const handSuitColors = getRenderedHandSuitColors()
  if (handSuitColors === null) return
  if (
    Array.isArray(state.handSuitColors) &&
    state.handSuitColors.length === handSuitColors.length &&
    state.handSuitColors.every((color, index) => color === handSuitColors[index])
  ) {
    return
  }

  const nextState = { ...state, handSuitColors }
  Game.setSpellState(4022, nextState)
  renderPeiXiuMapWindow(nextState, SpellExtendConfig.GetInstance().PeiXiuBonus)
}

subscribeRenderedMainHandCardIDs(refreshPeiXiuHandSuitColors)
