import { updateResult } from '@/utils'
import { CardConfig } from '../config'
import { getTrackedPileCardIDs } from './utils'

export default function handleHeZhong(context) {
  const { game } = context

  if (context.FromID != game.currentID) return

  const configInstance = CardConfig.GetInstance()
  const cardNum = configInstance.getCardNumber(context.CardIDs[0])
  const paidui = getTrackedPileCardIDs()

  const countCardsByNames = (names) => {
    const targetIds = new Set()
    const nameSet = new Set(names)

    for (const id of configInstance.cardIDsOrder) {
      if (nameSet.has(configInstance.getCard(id)?.name)) targetIds.add(id)
    }

    const acc = { g: 0, l: 0, e: 0 }

    for (const id of paidui) {
      if (targetIds.has(id)) {
        const num = configInstance.getCardNumber(id)
        if (num > cardNum) acc.g++
        else if (num < cardNum) acc.l++
        else acc.e++
      }
    }

    return acc
  }

  const A = countCardsByNames([
    '无中',
    '洞烛',
    '顺手',
    '过拆',
    '逐近',
    '决斗',
    '南蛮',
    '万箭',
    '出其',
    '水淹',
    '随机',
    '洪荒',
    '同舟',
    '力争',
    '移花'
  ])

  const B = countCardsByNames(['五谷', '桃园', '火攻', '借刀', '撒豆'])

  updateResult(
    '<span class="textRes">【和衷】' +
      (A.g > A.l ? '大' : A.g < A.l ? '小' : B.g > B.l ? '大' : B.g < B.l ? '小' : '平') +
      '</span>' +
      '<br><span class="textRes">' +
      A.g +
      '.' +
      B.g +
      '大\t\t' +
      A.l +
      '.' +
      B.l +
      '小</span>'
  )
}
