import handleChengXiang from './skills/ChengXiang'
import handleQingYiLianJu from './skills/QingYiLianJu'
import handleQianFu from './skills/QianFu'
import handleJiaoYu from './skills/JiaoYu'
import handleShengMo from './skills/ShengMo'
import handleXiaShu from './skills/XiaShu'
import handleZeXing from './skills/ZeXing'
import handleZuoLian from './skills/ZuoLian'

export const spellEffectHandlers = new Map([
  [361, handleXiaShu],
  [441, handleChengXiang],
  [3492, handleChengXiang],
  // [3033, handleJiZhan],
  // [3329, handleHeZhong],
  [3488, handleZuoLian],
  [3157, handleQingYiLianJu],
  [3511, handleQingYiLianJu],
  [3571, handleJiaoYu],
  [3750, handleQianFu],
  [3854, handleZeXing],
  [3434, handleShengMo]
])

// 使用已有信息修改 cardIDs 简单不用处理 真是一个好方法吗?
export function applySpellEffect(context) {
  const handler = spellEffectHandlers.get(context.SpellID)
  if (!handler) return false

  handler(context)
  return true
}
