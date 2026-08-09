import { CardConfig, SpellExtendConfig } from '@/config'
import { Game } from '@/tracker'
import {
  getRenderedMainHandCardIDs,
  subscribeRenderedMainHandCardIDs
} from '@/tracker/view/PlayerHandView'
import { renderPeiXiuMapWindow } from './PeiXiuMapWindow'

let unsubscribeRenderedMainHandCardIDs = null

/**
 * 读取当前已渲染的主视角手牌花色；尚未完成主手牌镜像时返回 null。
 */
export function getRenderedPeiXiuHandSuitColors() {
  const cardIDs = getRenderedMainHandCardIDs()
  if (cardIDs === null) return null

  const cardConfig = CardConfig.GetInstance()
  return cardIDs
    .map((id) => Number(cardConfig.getCardColor(id)))
    .filter((color) => color >= 1 && color <= 4)
}

/** 根据主视角手牌镜像刷新裴秀尽览窗口中的手牌花色。 */
export function refreshPeiXiuHandSuitColors() {
  const state = Game.getSpellState(4022)
  if (!state?.usesMainHandMirror || !state.result) return

  const handSuitColors = getRenderedPeiXiuHandSuitColors()
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

/** 绑定应用级主手牌镜像监听；重复调用不会重复注册。 */
export function bindPeiXiuHandSuitColorRefresh() {
  if (unsubscribeRenderedMainHandCardIDs) return

  unsubscribeRenderedMainHandCardIDs = subscribeRenderedMainHandCardIDs(refreshPeiXiuHandSuitColors)
}

/** 解绑应用级主手牌镜像监听。 */
export function unbindPeiXiuHandSuitColorRefresh() {
  unsubscribeRenderedMainHandCardIDs?.()
  unsubscribeRenderedMainHandCardIDs = null
}
