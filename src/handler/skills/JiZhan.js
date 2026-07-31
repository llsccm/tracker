import { CardConfig } from '@/config'
import { updateResult } from '@/utils'
import { getTrackedPileCardIDs } from './utils'

export function handleJiZhan(context) {
  if (
    context.FromZone == 1 &&
    context.ToZone == 8 &&
    context.CardIDs.filter((id) => id > 0).length == 1
  ) {
    const cardNum = CardConfig.GetInstance().getCardNumber(context.CardIDs.find((id) => id > 0))
    let g = 0
    let l = 0
    let e = 0

    getTrackedPileCardIDs().forEach((id) => {
      const num = CardConfig.GetInstance().getCardNumber(id)
      if (num === cardNum) e++
      else if (num > cardNum) g++
      else l++
    })

    updateResult(
      `<span class="textRes">【吉占】猜${g > l ? '大' : '小'}</span><br><span class="textRes">跟${cardNum}比，${g}张大\t\t${l}张小\t\t${e}平</span>`
    )
  }
}
