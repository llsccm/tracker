import { updateResult } from '@/utils'
import { CardConfig } from '../config'
import { drawChengXiang } from '../draw'
import { tracker } from '../tracker/runtime/browser'

export function getTrackedPileCardIDs() {
  return tracker.getReadyTrackerRoom()?.publicZones.getPileCardIDs() ?? []
}

function handleChengXiang(context) {
  if (context.ToZone == 8 && context.MoveType == 6) {
    const arr = context.CardIDs.map((id) => CardConfig.GetInstance().getCardNumber(id))
    drawChengXiang(arr, context.SpellID == 3492)
  }
}

function handleHeZhong(context) {
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

function handleJieWu(context) {
  if (context.MoveType == 21) {
    const spellCards = context.game.ensureSpellState(context.SpellID, () => [])
    spellCards.push(context.CardIDs.find((id) => id > 0))
  }
}

function handleZhuoHun(context) {
  const { game } = context

  if (context.FromZone == 5 && context.FromID == game.myID) {
    const state =
      game.spellSpace[3821] || (game.spellSpace[3821] = { used: new Set(), pending: [] })
    state.pending = context.CardIDs.filter((id) => id > 0)
      .map((cardId) => CardConfig.GetInstance().getCard(cardId)?.name || '')
      .filter(Boolean)
  }
}

function handleZuoLian(context) {
  const { game } = context

  if (context.FromZone === 5 && context.ToZone === 5 && context.MoveType === 21) {
    const positiveIDs = context.CardIDs.filter((id) => id > 0)

    if (positiveIDs.length === 1) {
      const spellState = game.ensureSpellState(context.SpellID, () => ({}))
      spellState[context.FromID] = positiveIDs[0]
    }
  } else if (context.FromZone === 5 && context.ToZone === 10 && context.MoveType === 11) {
    if (!context.CardIDs.some((id) => id > 0)) {
      const spellState = game.ensureSpellState(context.SpellID, () => ({}))

      context.CardIDs[0] = spellState[context.FromID] || 0
      spellState.stack = context.CardIDs[0]
    }
  } else if (
    context.FromZone === 10 &&
    (context.ToZone === 1 || context.ToZone === 2) &&
    context.MoveType === 11
  ) {
    if (!context.CardIDs.some((id) => id > 0)) {
      const spellState = game.getSpellState(context.SpellID)
      context.CardIDs[0] = spellState?.stack || 0

      if (spellState) {
        delete spellState.stack
      }
    }
  }
}

function handleQingYiLianJu(context) {
  const spellCards = context.game.getSpellState(context.SpellID)
  if (
    context.FromZone == 2 &&
    context.ToZone == 5 &&
    context.CardCount == spellCards?.length &&
    context.CardIDs.filter((id) => id > 0).length == 0
  ) {
    spellCards.forEach((id, i) => {
      context.CardIDs[i] = id
    })
    context.game.deleteSpellState(context.SpellID)
  }
}

function handleJiaoYu(context) {
  if (
    context.FromZone == 8 &&
    context.ToZone == 5 &&
    context.MoveType == 8 &&
    context.CardIDs.filter((id) => id > 0).length == 0
  ) {
    const spellCards = context.game.getSpellState(context.SpellID)
    const spellCardIDs = Array.from(spellCards || [])
    if (spellCardIDs.length) {
      context.CardIDs.splice(0, Infinity, ...spellCardIDs)
    }
  }
}

function handleQianFu(context) {
  if (
    context.FromZone == 2 &&
    context.ToZone == 1 &&
    context.MoveType == 15 &&
    context.CardIDs.filter((id) => id > 0).length == 0
  ) {
    const spellCards = context.game.getSpellState(context.SpellID)
    if (spellCards?.length) {
      context.CardIDs.splice(0, Infinity, ...spellCards)
    }
  }
}

export const spellEffectHandlers = new Map([
  [441, handleChengXiang],
  [3492, handleChengXiang],
  // [3033, handleJiZhan],
  [3329, handleHeZhong],
  [3659, handleJieWu],
  [3821, handleZhuoHun],
  [3488, handleZuoLian],
  [3157, handleQingYiLianJu],
  [3511, handleQingYiLianJu],
  [3571, handleJiaoYu],
  [3750, handleQianFu]
  // [7016, handleYanXi],
  // [7017, handleYanXi]
])

export function applySpellEffect(context) {
  const handler = spellEffectHandlers.get(context.SpellID)
  if (!handler) return false

  handler(context)
  return true
}
