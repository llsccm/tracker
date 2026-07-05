import { getCardFaceHtml } from '@/utils'
import type { Card } from '../Card'
import type { CardInstance, CardInstanceStatus } from '../CardCounter'
import type { Room } from '../Room'

interface CardButtonOptions {
  ambiguous?: boolean
}

const STATUS_COLORS = ['', 'cyan', '#23201d', 'green']
const STATUS_LABELS = ['牌堆', '', '弃牌堆', '销毁']
const CARD_BUTTON_CLASS = 'shoupai'
const RED_CARD_CLASS = 'red-card'
const UNKNOWN_CARD_CLASS = 'unknown-card'

/**
 * 为重构版 Card 实例生成手牌/公共区用的 shoupai 按钮
 * tooltip 走 card.getLocationDescription()，不依赖旧版 cardManager.findKZ
 * @param doc - 目标 document（iframe.contentDocument）
 */
export function createCardButton(
  doc: Document,
  card: Card,
  options: CardButtonOptions = {}
): HTMLButtonElement {
  const button = doc.createElement('button')
  button.classList.add(CARD_BUTTON_CLASS)
  button.id = 'card' + card.id
  button.classList.toggle(RED_CARD_CLASS, card.color > 0 && card.color <= 2)
  button.innerHTML = getCardFaceHtml(card)
  button.title = card.getLocationDescription?.() ?? ''

  if (options.ambiguous) {
    button.classList.add('candidate-card')
    button.setAttribute('aria-disabled', 'true')
  }

  return button
}

/**
 * 生成暗牌占位按钮（连续暗牌合并为一张）
 */
export function createUnknownButton(doc: Document, count: number): HTMLButtonElement {
  const button = doc.createElement('button')
  button.classList.add(CARD_BUTTON_CLASS, UNKNOWN_CARD_CLASS)
  button.disabled = true
  button.innerHTML = count > 1 ? `暗×${count}` : '暗'
  button.title = `${count} 张暗牌`
  return button
}

/**
 * 生成查询面板的单卡按钮，按位置状态着色
 * @param key - 位置状态（0 牌堆 / 1 场上 / 2 弃牌 / 3 销毁）
 */
export function createQueryButton(
  doc: Document,
  inst: CardInstance,
  key: CardInstanceStatus,
  room?: Room
): HTMLButtonElement {
  const button = doc.createElement('button')
  button.classList.add(CARD_BUTTON_CLASS)
  button.classList.toggle(RED_CARD_CLASS, inst.color > 0 && inst.color <= 2)
  button.id = 'Qcard' + inst.id
  button.innerHTML = getCardFaceHtml(inst)
  button.style.backgroundColor = STATUS_COLORS[key] ?? ''

  if (key === 1) {
    const card = room?.cardIndex?.get(inst.id)
    button.title = card?.getLocationDescription?.() ?? ''
  } else {
    button.title = STATUS_LABELS[key] ?? ''
  }

  return button
}
