import { CharacterConfig, RoguelikeConfig } from '@/config'
import { globalConfig, globalState, rogueMap, UI } from '@/tracker'
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
  // console.info('drawRogueLike', ProtoObj);
  if (!ProtoObj?.allData) return

  const allData = ProtoObj.allData
  const dataMark = ProtoObj.dataMark
  const marks = Array.from(Number(dataMark).toString(2), Number).reverse()

  if (marks[4]) {
    //console.info('drawRogueLike: 需要处理商店数据, marks[4]=true');
    if (!allData.shopData) {
      //console.info('drawRogueLike: allData中无商店数据');
      return req()
    } else {
      //console.info('drawRogueLike: allData已有商店数据，重置req状态');
      req(0)
    }

    globalState.rogueShopBShow = allData.shopData.bShow === true
    allData.shopData.bShow = true
  }

  const shopData = allData.shopData
  const chapterData = allData.chapterData
  const generalpool = allData.generalpool
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

// 山河图
const ROGUE_ATTR_LABELS = [
  { key: 'rep', label: '声望' },
  { key: 'tro', label: '战功' },
  { key: 'wis', label: '智谋' },
  { key: 'mar', label: '商才' },
  { key: 'loy', label: '忠诚' },
  { key: 'ass', label: '权谋' },
  { key: 'cha', label: '魅力' }
]

function renderRogueAttrInfo(attrInfo) {
  const container = document.getElementById('rogueAttrInfo')
  if (!container) return
  if (!attrInfo) {
    container.textContent = '结局倾向未同步'
    return
  }
  const badges = ROGUE_ATTR_LABELS.map(({ key, label }) => {
    const value = Number.isFinite(attrInfo[key]) ? attrInfo[key] : (attrInfo[key] ?? 0)
    return `<span class="rogue-attr-badge">${label}:${value}</span>`
  }).join('')
  container.innerHTML = badges
}

// req函数：使用闭包实现请求控制
const req = (() => {
  let ok = false // 请求状态标志

  return function (dm = 63) {
    // dm=0时重置ok=false
    if (!dm) return (ok = false)

    if (ok) {
      console.info('req: 已请求过，跳过重复请求, dm=', dm)
      return true // 如果已请求过，返回true但不再请求
    }

    ok = true // 设置已请求标志
    return laya.class('RogueLikePveManager')?.RogueLikeDataReq(dm) // 发送请求
  }
})()
