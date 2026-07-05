import { hasAdvancedFeature, notifyAdvancedFeatureTrial } from './trial.js'

export function setGeneralTip({
  key,
  seatUis = [],
  seat = null,
  avatar = null,
  text = '',
  getText = null
} = {}) {
  if (!key) return
  const allowed = hasAdvancedFeature(key)
  const list = avatar ? [{ seat: avatar.seat, seatAvatar: avatar }] : seatUis
  list.forEach((ui) => {
    if (seat && ui?.seat != seat) return
    const card = ui?.seatAvatar
    if (!card) return
    const value = allowed ? (typeof getText == 'function' ? getText(ui) : text) : ''
    const content = value ? String(value) : ''
    if (content) notifyAdvancedFeatureTrial(key)
    const prop = `__xcGeneralTip_${key}`
    let txt = card[prop]
    if (!txt && !content) return
    if (!txt) {
      txt = new Laya.Text()
      txt.fontSize = 12
      txt.color = '#FFFFFF'
      txt.stroke = 2
      txt.strokeColor = '#000000'
      txt.align = 'right'
      txt.leading = 0
      txt.mouseEnabled = false
      txt.zOrder = 999
      txt.width = 70
      txt.height = 90
      txt.pos(Math.max(0, card.width - txt.width - 15), 40)
      card[prop] = txt
      card.addChild(txt)
    }
    if (txt.text != content) txt.text = content
    txt.visible = Boolean(content)
  })
}
