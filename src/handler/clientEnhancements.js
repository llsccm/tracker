import { laya } from '../runtime/gameAdapter'
import { Game, globalConfig, user } from '../tracker'
import { showStatusTip } from '../ui/statusTip'
import { wait } from '../utils'

export function handleAdWindow() {
  if (!globalConfig.skipAdWindowSwitch) return

  wait(() => laya.GetWindow('AdPushWindow'))
    .then((win) => win?.Close())
    .catch((error) => console.error(error))
}

export function handleKillEffect(msg) {
  if (globalConfig.blockKillEffectSwitch) msg.Type = 0
}

export function handleGeneralSkin(msg) {
  if (import.meta.env.DEV) console.info(msg)
  if (!Game.isGameStart || !globalConfig.blockSkinStateSwitch) return

  const GeneralSkinList = msg.GeneralSkinList || []
  GeneralSkinList.forEach((GeneralSkin) => {
    if (!GeneralSkin) return
    // 只显示主视角动态皮肤。
    if (Game.myGenerals.includes(GeneralSkin.GeneralID)) return
    GeneralSkin.state = 0
  })
}

export function handleUserProfileSkin(msg) {
  if (!globalConfig.blockSkinStateSwitch) return
  if (msg.ProtoObj?.nickname_usertempid === user.userID) return

  if (msg.Info) msg.Info.IsUseDySkinShow = false
}

export function handleTableInfo() {
  wait(() => laya.blockPowerSlogan()).catch((error) => console.error(error))
}

export function handlePackageOpened() {
  if (!globalConfig.skipPackageWindowSwitch) return

  wait(() => laya.GetWindow('GeneralOpenResultWindow'))
    .then((win) => win?.Close())
    .catch((error) => console.error(error))
}

export function handleGeneralWishPool(data) {
  const progress = Array.isArray(data?.list) ? data.list[0] : null
  if (!progress?.ratio) return
  showStatusTip('wishPool', `心愿武将当前进度: ${progress.ratio / 100}%`)
}

export function handleSkinWishPool(data) {
  const list = Array.isArray(data?.list) ? data.list : []
  const progress = list.find((item) => item?.round === list.length)
  if (!progress?.ratio) return
  showStatusTip('wishPool', `心愿皮肤当前进度: ${progress.ratio / 100}%`)
}
