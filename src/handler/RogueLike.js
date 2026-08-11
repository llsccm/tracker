import { CharacterConfig, RoguelikeConfig } from '@/config'
import { globalConfig, rogueMap, UI } from '@/tracker'
import { laya } from '@/runtime/gameAdapter'
import { drawCitiesUI, drawStore } from '@/ui/CitiesUI'
import { addTooltip } from '@/utils/notification'

export async function showShanHeTuSponsorPrompt(ProtoObj) {
  if (!ProtoObj?.allData) return

  const allData = ProtoObj.allData
  rogueMap.general = allData.gameData?.myGeneral?.uGeneralId ?? 0
  rogueMap.itemId = allData.gameData?.itemId ?? []
}

export async function handleRogueLike(ProtoObj) {
  if (!ProtoObj?.allData) return

  const allData = ProtoObj.allData
  // 00111111
  const dataMark = ProtoObj.dataMark
  const shopData = allData.shopData
  const chapterData = allData.chapterData
  const generalpool = allData.generalpool

  // RougueLikeShopType 商店数据
  if ((dataMark & 16) !== 0) {
    if (!shopData) {
      return req()
    } else {
      shopData.bShow = true
      req(0)
    }
  }

  // 结局倾向
  renderRogueAttrInfo(allData.gameData?.attrInfo)

  if (shopData) {
    const storeItem = []
    const roguelikeConfig = RoguelikeConfig.GetInstance()

    if (shopData.itemId && roguelikeConfig.shopDict.size) {
      for (const i of shopData.itemId) {
        const plot = roguelikeConfig.getPlot(i)
        if (plot) storeItem.push(plot['name'])
      }
    }

    drawStore(storeItem)
  }

  if (generalpool?.general_change?.length > 0) {
    const general_change = generalpool.general_change.map(
      (element) => CharacterConfig.GetInstance().generalDict[element] || `Unknown (${element})`
    )

    addTooltip(
      `小抄提示：可换将为${general_change.reverse().join(', ')}`,
      'acTooltip',
      10000,
      'green',
      null,
      true
    )
  }

  const seasonData = allData.seasonData
  const difficulty = seasonData && seasonData.difficulty
  difficulty && (rogueMap.difficulty = difficulty)

  rogueMap.general = allData.gameData?.myGeneral?.uGeneralId ?? 0
  rogueMap.itemId = allData.gameData?.itemId ?? []

  if (chapterData?.locations) {
    UI.cities = chapterData.locations.map((l) => ({
      id: l.location,
      event: l.event
    }))

    RoguelikeConfig.GetInstance().levelDict.size &&
      globalConfig.rogueCitySwitch &&
      drawCitiesUI(UI.cities, '')
  }
}

function renderRogueAttrInfo(attrInfo) {
  if (!attrInfo) return

  const container = document.getElementById('rogueAttrInfo')
  if (!container) return

  for (const badge of container.querySelectorAll('[data-rogue-attr]')) {
    const valueContainer = badge.querySelector('.rogue-attr-value')
    if (!valueContainer) continue

    const value = Number(attrInfo[badge.dataset.rogueAttr])
    valueContainer.textContent = Number.isFinite(value) ? value : 0
  }
}

// req函数：使用闭包实现请求控制
const req = (() => {
  let ok = false // 请求状态标志

  return function (dm = 63) {
    // dm=0时重置ok=false
    if (!dm) return (ok = false)

    if (ok) {
      console.warn('req: 已请求过，跳过重复请求, dm=', dm)
      return true // 如果已请求过，返回true但不再请求
    }

    ok = true // 设置已请求标志
    return laya.class('RogueLikePveManager')?.RogueLikeDataReq(dm) // 发送请求
  }
})()
