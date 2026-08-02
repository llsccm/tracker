import { POSITION_RANDOM, POSITION_TOP } from '../tracker/candidate/cardPositions'

function finishHandledMove(context) {
  context.finishMove()
  return { handled: true }
}

export function handleSpecialZones(context) {
  const { game } = context

  // 回收区 12
  if (context.ToZone == 12 || context.FromZone == 12) {
    return finishHandledMove(context)
  }

  // 浑天仪特殊底置 (随机)
  if (
    context.SpellID == 3694 &&
    context.FromZone == 0 &&
    context.ToZone == 1 &&
    context.ToPosition == POSITION_TOP + 1 &&
    context.MoveType == 19
  ) {
    context.ToPosition = POSITION_RANDOM

    return finishHandledMove(context)
  }

  // 牌堆添加初始牌
  if (
    context.FromZone == 0 &&
    context.ToZone == 1 &&
    context.ToPosition == POSITION_TOP &&
    context.MoveType == 19
  ) {
    if (!game.isGameStart) game.isGameStart = null

    return finishHandledMove(context)
  }

  // 弃牌堆 2 丢到洗牌堆 9
  if (context.FromZone == 2 && context.ToZone == 9 && context.MoveType == 255) {
    game.isPassed = false
    return finishHandledMove(context)
  }

  return { handled: false }
}
