import { CardConfig, SkillsConfig } from './config'
import { checkEllipsisOverflow, invalidateEllipsisOverflow } from './ui/overflowEllipsis'
import { getCardFaceHtml } from './utils'

export { drawChengXiang } from './draw/drawChengXiang'
export { drawMiZhu } from './draw/drawMiZhu'
export { drawYanJiao } from './draw/drawYanJiao'
export { drawYiCheng } from './draw/drawYiCheng'

/**
 * 渲染最近一次使用/记录的手牌按钮。
 * 单张实体牌用 CardConfig 元数据渲染；多张或无实体牌时按技能名渲染。
 * 没有可渲染内容时直接跳过，保留上一次的残影。
 * @param {number[]} cardIDs
 * @param {{ spellId?: number, color?: number }} [options] color: 1 红 2 黑 0 无色（按黑渲染）
 */
export function drawLastUseCard(cardIDs = [], { spellId, color } = {}) {
  const toBeAdd = document.getElementById('lastUseCard')
  if (!toBeAdd) return

  const ids = (cardIDs || []).filter((id) => id)

  let card
  let isRed
  if (ids.length === 1) {
    card = CardConfig.GetInstance().getCard(ids[0])
    isRed = card?.color === 1 || card?.color === 2
  } else {
    // 多张转化牌或没有实体牌的虚拟牌：有技能 ID 时按技能名渲染
    card = spellId ? SkillsConfig.GetInstance().getSpell(spellId) : null
    isRed = color === 1
  }
  if (!card) return

  const button = document.createElement('button')
  button.classList.add('shoupai')
  button.classList.toggle('red-card', isRed)
  button.innerHTML = getCardFaceHtml(card)

  // 容器里还有 legend，只替换卡牌按钮
  clearDirectCards(toBeAdd)
  toBeAdd.appendChild(button)
}

function clearDirectCards(element) {
  if (!(element instanceof HTMLElement)) return
  invalidateEllipsisOverflow(element)
  element.querySelectorAll(':scope > .shoupai, :scope > .markedCard').forEach((e) => e.remove())
}

/**
 * 清理所有区域镜像。
 * 对局销毁或视图重挂载时调用，确保旧 DOM 不污染下一局座位。
 */
export function clearZoneMirrors() {
  document.querySelectorAll('#seatUI .sorder-body').forEach(clearDirectCards)
  document.querySelectorAll('#seatUI .markedCard').forEach((element) => element.remove())
}

export function refreshZoneMirrorOverflow() {
  document.querySelectorAll('.sorder-body').forEach((orderBody) => {
    checkEllipsisOverflow(orderBody, 40)
  })
}
