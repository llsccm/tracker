// import { CardConfig } from '@/config'
import { drawCard } from '@/draw'
import { laya } from '@/runtime/gameAdapter'
import { Game } from '@/tracker'
// import { setSuitRecord } from '@/utils'

export function handleUseCard(msg) {
  const { SeatID } = msg

  // 渐营
  // if (
  //   Game.currentID == SeatID &&
  //   Game.getSeatUI(Game.currentID)?.seat?.HasSkill(491) &&
  //   msg.useType == 1 &&
  //   !msg.isSend
  // ) {
  //   setSuitRecord(CardConfig.GetInstance().getCard(msg.CardID).cn)
  // }

  if (SeatID !== Game.myID) return

  drawCard([msg.CardID])

  // 战法计数
  if (msg.useType == 1 && !msg.isSend) {
    // 同步计数 三板斧 手到擒来
    if (msg.spellID === 1) {
      Game.shaCounter()
      laya.shaCounter()
    }

    if (msg.spellID) {
      Game.useCounter()
      laya.useCounter()
    }
  }
}
