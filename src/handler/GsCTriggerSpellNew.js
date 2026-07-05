import { CardConfig } from '@/config'
// import { laya } from '@/runtime/gameAdapter'
import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'

// function getSpellText(id) {
//   return id
//     ? `<font color='#FFFF00' href='1|${id}|0|2'>"${SkillsConfig.GetInstance().getSpellName(id)}"</font>`
//     : '未知技能'
// }

// function getSeatText(seat) {
//   const name = Game.name(seat, null)
//   return name ? `<font color='#FFFF00' >${name}${seat == Game.myID ? '(你)' : ''}</font>` : ''
// }

function getShuangXiongCards(seatID) {
  const player = tracker.getReadyTrackerRoom()?.getPlayer(Number(seatID))

  return (player?.knownHandCards ?? [])
    .concat(player?.equipCards ?? [])
    .filter((card) => card.isKnown === true && card.id > 0)
}

// function traceTriggerSpell(msg, data) {
//   laya.trace(
//     `<font color='#00FFFF'>&gt;&gt;</font>` +
//       (!data[0]?.SpellId
//         ? ((a, b) => (a && b ? a + '的' + b : a || b))(
//             getSeatText(msg.SrcSpellCasterSeat),
//             msg.SrcSpellID ? getSpellText(msg.SrcSpellID) : ''
//           )
//         : '') +
//       `<font color='#00FFFF'>&gt;</font>` +
//       ((a) => (a ? '向' + a : ''))(getSeatText(msg.TriggerSeatId)) +
//       '询问' +
//       data
//         .map(
//           ({ SpellId, SeatId, Targets }) =>
//             ((a, b) => (b ? `对${b}的` : a ? `${a}的` : ''))(
//               SeatId != msg.TriggerSeatId ? getSeatText(SeatId) : '',
//               Targets?.map(getSeatText).join(',') || ''
//             ) + getSpellText(SpellId)
//         )
//         .join(',')
//   )
// }

function drawShuangXiongTip(msg) {
  if (msg.TriggerSpellData?.[0]?.SpellId != 3269 || msg.TriggerSeatId != Game.myID) return

  let r = 0
  let b = 0

  getShuangXiongCards(msg.TriggerSeatId).forEach((node) => {
    const color = CardConfig.GetInstance().getCardColor(node.id)
    color === 1 || color === 2 ? r++ : color === 3 || color === 4 ? b++ : 0
  })

  document.getElementById('result').innerHTML =
    '<span class="textRes">【双雄】' +
    (r > b ? '弃 黑' : r < b ? '弃 红' : '平') +
    '</span>' +
    '<br><span class="textRes">' +
    r +
    '红\t\t' +
    b +
    '黑</span>'
}

export function handleTriggerSpellNew(msg) {
  // 技能读条
  const data = msg.TriggerSpellData?.length ? msg.TriggerSpellData : [{}]
  //.filter(({ SpellId }) => !SpellId || [13].includes(SpellId));

  if (!data.length) return

  // traceTriggerSpell(msg, data)
  drawShuangXiongTip(msg)
}
