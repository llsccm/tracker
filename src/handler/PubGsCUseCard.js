import { drawLastUseCard } from '@/draw'
import { laya } from '@/runtime/gameAdapter'
import { Game } from '@/tracker'
// import { setSuitRecord } from '@/utils'

export function handleUseCard(msg) {
  const { CardID, spellID, useType } = msg
  // if (import.meta.env.DEV) console.info(msg)
  // PubGsCUseCard : spellID CardID
  // MsgNtfUseCardType : spellId cardIds color spellType
  // spellType 0: 无属性 6: 火 7: 雷 11: 冰
  const spell = spellID || msg.spellId
  const cardIDs = CardID ? [CardID] : msg.cardIds || []
  const SeatID = msg.SeatID || msg.castSeatId

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

  if (useType == 1) drawLastUseCard(cardIDs, { spellId: spell, color: msg.color })

  // 战法计数
  if (useType == 1 && spell) {
    // 同步计数 三板斧 手到擒来
    if (spell === 1) {
      Game.shaCounter()
      laya.shaCounter()
    }

    Game.useCounter()
    laya.useCounter()
  }
}
