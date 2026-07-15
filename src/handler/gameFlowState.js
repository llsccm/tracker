import { CardConfig } from '../config'
import { tracker } from '../tracker/runtime/browser'
import { POSITION_RANDOM } from '../tracker/candidate/cardPositions'

const excludeNames = new Set(['乐', '兵', '闪电'])
const shaNames = new Set(['杀', '火杀', '雷杀', '冰杀'])

function getTrackedPlayerHandCardIDs(seatID) {
  return tracker.getReadyTrackerRoom()?.getPlayerHandCardIDs(seatID) ?? []
}

function updateResult(html) {
  if (typeof document === 'undefined') return
  const result = document.getElementById('result')
  if (!result) return
  result.innerHTML = html
}

function updateQuanDaoDisplay(context) {
  const { game } = context

  if (
    !(
      (context.FromZone == 5 || context.ToZone == 5) &&
      (context.ToID == game.myID || context.FromID == game.myID)
    )
  ) {
    return
  }

  let cards = getTrackedPlayerHandCardIDs(game.myID).slice()

  if (context.ToZone == 5) {
    cards.push(...context.CardIDs)
  } else if (context.FromZone == 5) {
    cards = cards.filter((card) => !context.CardIDs.includes(card))
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

  updateResult(
    '<span class="textRes">【权道】杀：普通锦囊</span>' +
      '<br><span class="textRes">' +
      countSha +
      '：' +
      countType2 +
      '</span>'
  )
}

export function handleGameFlowState(context) {
  const { game } = context

  // 初始发牌阶段：明牌发牌不应按牌堆固定位置处理。
  if (
    context.FromZone == 1 &&
    context.MoveType == 19 &&
    context.SpellID == 0 &&
    !game.isGameStart &&
    !game.isPassed
  ) {
    if (game.isPassed === false) {
      game.isPassed = null
    }

    if (game.isGameStart !== null && context.FromZone == 1) {
      context.FromPosition = POSITION_RANDOM
    }
  }

  // 牌堆摸牌阶段：处理录像主视角识别、开局状态兼容和正常对局战法计数。
  if (context.FromZone == 1 && context.ToZone == 5 && context.MoveType == 1) {
    const isFaceUpDraw = context.CardIDs.filter((id) => id > 0).length == context.CardCount

    // 录像无法依赖用户 UUID 确定主视角；首次摸到明牌的座位即为录像主视角。
    // 22 使用其他方式确认主视角
    if (game.isRecord && game.room?.mySeatID === undefined && isFaceUpDraw) {
      tracker.setTrackerMySeatID(context.ToID)
    }

    // 兼容开局状态尚未稳定时收到的摸牌协议。
    if (!game.isGameStart && !game.isPassed) {
      if (game.isGameStart === null) {
        game.isGameStart = false
      }

      if (isFaceUpDraw) {
        context.FromPosition = POSITION_RANDOM
      }
    }

    // 正常摸牌时，仅累计主视角的战法摸牌计数。
    if (game.myID !== undefined && context.ToID === game.myID) {
      game.record({ mo: context.CardCount })
    }
  }

  // 卡牌标记（小抄标签，当前停用）。
  // if (
  //   globalConfig.cardLabelSwitch &&
  //   context.ToZone == 5 &&
  //   context.FromZone != 12 &&
  //   context.ToID == game.myID &&
  //   context.SpellID &&
  //   context.MoveType > 1 &&
  //   context.MoveType < 255
  // ) {
  //   let name = SkillsConfig.GetInstance().getSpellName(context.SpellID)
  //   name = name ? `[${shortName[name] || name.slice(0, 2)}]` : ''
  //   const fromSeatID =
  //     context.FromZone == 5 && context.FromID != 255 && context.FromID != game.myID
  //       ? context.FromID
  //       : null
  //   const fromSeatName = fromSeatID !== null ? game.name(fromSeatID, false) : ''
  //   laya.mark(context.CardIDs, `\u200B${name}${fromSeatName || ''}`, (t) =>
  //     t.startsWith('\u200B')
  //   )
  // }

  updateQuanDaoDisplay(context)
}
