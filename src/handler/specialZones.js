import { POSITION_TOP } from '../tracker/candidate/cardPositions'

function finishHandledMove(context) {
  context.finishMove()
  return { handled: true }
}

export function handleSpecialZones(context) {
  const { game, patched } = context

  // 回收区 12
  if (patched.ToZone == 12 || patched.FromZone == 12) {
    return finishHandledMove(context)
  }

  // 牌堆添加初始牌
  if (
    patched.FromZone == 0 &&
    patched.ToZone == 1 &&
    patched.ToPosition == POSITION_TOP &&
    patched.MoveType == 19
  ) {
    if (!game.isGameStart) game.isGameStart = null

    return finishHandledMove(context)
  }

  // 弃牌堆 2 丢到洗牌堆 9
  if (patched.FromZone == 2 && patched.ToZone == 9 && patched.MoveType == 255) {
    game.isPassed = false
    return finishHandledMove(context)
  }

  return { handled: false }
}
