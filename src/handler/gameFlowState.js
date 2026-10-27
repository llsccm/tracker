import { CardConfig } from '../config'
import { tracker } from '../tracker/runtime/browser'
import { POSITION_RANDOM } from '../tracker/candidate/cardPositions'
import { laya } from '@/runtime/gameAdapter'

const excludeNames = new Set(['乐', '兵', '闪电'])
const shaNames = new Set(['杀', '火杀', '雷杀', '冰杀'])

function updateQuanDaoDisplay(context) {
  const { game, patched } = context

  if (
    !(
      (patched.FromZone == 5 || patched.ToZone == 5) &&
      (patched.ToID == game.myID || patched.FromID == game.myID)
    )
  ) {
    return
  }

  let cards = tracker.getTrackedPlayerHandCardIDs(game.myID).slice()

  if (patched.ToZone == 5) {
    cards.push(...patched.CardIDs)
  } else if (patched.FromZone == 5) {
    cards = cards.filter((card) => !patched.CardIDs.includes(card))
  }

  cards = cards
    .filter((id) => id > 0)
    .map((id) => CardConfig.GetInstance().getCard(id))
    .filter(Boolean)

  const { countType2, countSha } = cards.reduce(
    (acc, card) => {
      if (card.type === 2 && !excludeNames.has(card.name)) {
        acc.countType2++
      }

      if (shaNames.has(card.name)) {
        acc.countSha++
      }

      return acc
    },
    { countType2: 0, countSha: 0 }
  )

  if (typeof document === 'undefined') return
  const quanDao = document.getElementById('quanDao')
  if (quanDao) quanDao.textContent = `【权道】杀：${countSha} 普通锦囊：${countType2}`
}

export function handleGameFlowState(context) {
  const { game, patched } = context

  // 初始发牌阶段：明牌发牌不应按牌堆固定位置处理。
  if (
    patched.FromZone == 1 &&
    patched.MoveType == 19 &&
    patched.SpellID == 0 &&
    !game.isGameStart &&
    !game.isPassed
  ) {
    if (game.isPassed === false) {
      game.isPassed = null
    }

    if (game.isGameStart !== null && patched.FromZone == 1) {
      patched.FromPosition = POSITION_RANDOM
    }
  }

  // 牌堆摸牌阶段：处理录像主视角识别、开局状态兼容和正常对局战法计数。
  if (patched.FromZone == 1 && patched.ToZone == 5 && patched.MoveType == 1) {
    const isFaceUpDraw = patched.CardIDs.filter((id) => id > 0).length == patched.CardCount

    // 录像无法依赖用户 UUID 确定主视角；首次摸到明牌的座位即为录像主视角。
    // 22 使用其他方式确认主视角
    if (game.isRecord && game.myID === undefined && isFaceUpDraw) {
      tracker.setTrackerMySeatID(patched.ToID)
    }

    // 兼容开局状态尚未稳定时收到的摸牌协议。
    if (!game.isGameStart && !game.isPassed) {
      if (game.isGameStart === null) {
        game.isGameStart = false
      }

      if (isFaceUpDraw) {
        patched.FromPosition = POSITION_RANDOM
      }
    }

    // 正常摸牌时，仅累计主视角的战法摸牌计数。
    if (game.myID !== undefined && patched.ToID === game.myID && game.turn > 0) {
      game.drawCounter(patched.CardCount)
      laya.drawCounter()
    }
  }

  // 卡牌标记（小抄标签，当前停用）。
  // if (
  //   globalConfig.cardLabelSwitch &&
  //   patched.ToZone == 5 &&
  //   patched.FromZone != 12 &&
  //   patched.ToID == game.myID &&
  //   patched.SpellID &&
  //   patched.MoveType > 1 &&
  //   patched.MoveType < 255
  // ) {
  //   let name = SkillsConfig.GetInstance().getSpellName(patched.SpellID)
  //   name = name ? `[${shortName[name] || name.slice(0, 2)}]` : ''
  //   const fromSeatID =
  //     patched.FromZone == 5 && patched.FromID != 255 && patched.FromID != game.myID
  //       ? patched.FromID
  //       : null
  //   const fromSeatName = fromSeatID !== null ? game.name(fromSeatID, false) : ''
  //   laya.mark(patched.CardIDs, `\u200B${name}${fromSeatName || ''}`, (t) =>
  //     t.startsWith('\u200B')
  //   )
  // }

  updateQuanDaoDisplay(context)
}
