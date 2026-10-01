import { RoguelikeConfig, SkillsConfig } from '@/config'
import { rogueMap } from '@/tracker'
import { laya } from '@/runtime/gameAdapter'
import { wait } from '@/utils'

let cityRenderVersion = 0

export function drawCitiesUI(cities) {
  const renderVersion = ++cityRenderVersion

  wait(
    () => {
      // 过期请求提前结束轮询，由下方序号检查阻止更新场景。
      if (renderVersion !== cityRenderVersion) return true
      const rogueScene = laya.find('SceneLayer', 'RogueSmallMapScene')
      return rogueScene?.cityView ? rogueScene : undefined
    },
    10,
    500,
    { immediate: true }
  )
    .then((rogueScene) => {
      if (renderVersion !== cityRenderVersion) return
      const cityView = rogueScene?.cityView
      if (!cityView || cityView.destroyed) return

      // 仅在场景就绪且请求仍有效时创建节点，避免留下未挂载的容器。
      renderCities(cities, cityView)
    })
    .catch((err) => {
      console.error(err)
    })
}

function renderCities(cities, cityView) {
  // 清理旧内容及其子节点、事件资源。
  for (let i = cityView.numChildren - 1; i >= 0; i--) {
    const child = cityView.getChildAt(i)
    if (child.name === 'city') {
      child.destroy(true)
    }
  }

  rogueMap.res = []
  const roguelikeConfig = RoguelikeConfig.GetInstance()

  for (const city of cities) {
    const cityData = roguelikeConfig.getCity(city.id)
    if (!cityData) continue

    const { x, y } = cityData

    const cityContainer = new Laya.Sprite()
    cityContainer.pos(x, y)
    cityContainer.zOrder = 999
    cityContainer.name = 'city'

    const rows = []
    const fight = roguelikeConfig.getFight(city.event)

    if (fight) {
      processFightEvent({ ...fight, event: city.event }, rows)
    } else {
      processChooseEvent(city.event, rows)
    }

    layoutCityContainer(cityContainer, rows)
    rogueMap.res.push({ id: city.id, city: cityContainer })
    cityView.addChild(cityContainer)
  }
}

// 样式常量
const STYLES = {
  TITLE: { color: '#f2de9c', fontSize: 18, bold: true },
  GENERAL: { normal: '#f2de9c', warning: 'rgb(240, 65, 85)', fontSize: 18 },
  GET_INFO: { color: '#f2de9c', fontSize: 16, bold: false }
}

const CITY_LAYOUT = {
  paddingX: 5,
  space: 4,
  minContentWidth: 150,
  dividerHeight: 1,
  backgroundColor: 'rgba(59, 58, 39, 0.75)',
  dividerColor: 'rgba(255, 255, 255, 0.2)'
}

function layoutCityContainer(container, rows) {
  if (rows.length === 0) return

  const { paddingX, space, minContentWidth, backgroundColor, dividerColor } = CITY_LAYOUT
  const contentWidth = Math.max(minContentWidth, ...rows.map((row) => row.width))
  const width = contentWidth + paddingX * 2
  const height = rows.reduce((sum, row) => sum + row.height + (row.text ? 0 : space * 2), 0) + 4

  container.size(width, height)
  container.graphics.drawRect(0, 0, width, height, backgroundColor)

  // 内容只在创建时排版；分割线占据行高，但不创建显示节点。
  let y = 2

  for (const row of rows) {
    if (row.text) {
      row.text.pos(paddingX + (contentWidth - row.width) / 2, y)
      container.addChild(row.text)
    } else {
      y += space
      container.graphics.drawRect(paddingX, y, contentWidth, row.height, dividerColor)
      y += space
    }

    y += row.height
  }
}

function createTextRow(config) {
  const text = new Laya.Text()
  text.text = config.text || ''
  text.color = config.color || '#ffffff'
  text.fontSize = config.fontSize || 16
  text.bold = config.bold || false

  text.font = 'fzltchjw'
  text.stroke = config.stroke || 2
  text.strokeColor = config.strokeColor || '#18140f'

  // Laya 默认延迟排版，先完成测量再读取包含换行的实际尺寸。
  text.typeset()

  return { text, width: text.textWidth, height: text.textHeight }
}

function createDividerRow() {
  return { text: null, width: CITY_LAYOUT.minContentWidth, height: CITY_LAYOUT.dividerHeight }
}

// 处理战斗事件内容
function processFightEvent(eventData, rows) {
  // 处理武将列表
  eventData.generals.forEach((general) => {
    rows.push(createGeneralRow(general, rogueMap.difficulty, eventData))
  })

  rows.push(createDividerRow())
  // 添加获取信息
  rows.push(
    createTextRow({
      text: eventData.get,
      ...STYLES.GET_INFO
    })
  )
}

// 处理选择事件内容
function processChooseEvent(baseEvent, rows) {
  const roguelikeConfig = RoguelikeConfig.GetInstance()
  const adventure = roguelikeConfig.getAdventure(baseEvent)

  for (const option of adventure?.options || []) {
    const eventData = roguelikeConfig.getChoice(option.effect)
    if (!eventData) continue

    // 处理武将选项
    if (eventData.generals) {
      eventData.generals.forEach((general) => {
        rows.push(createGeneralRow(general, rogueMap.difficulty, eventData))
      })
    }

    // 添加分割线
    rows.push(createDividerRow())

    // 添加获取信息
    const textParts = []

    if (!eventData.generals && eventData.lost) {
      textParts.push(`${eventData.lost} ${findLostItemByName(eventData.lost)}`)
    }

    if (eventData.get) textParts.push(`${eventData.get}`)

    if (textParts.length > 0) {
      rows.push(createTextRow({ text: textParts.join('\n'), ...STYLES.GET_INFO }))
    }
  }
}

function findLostItemByName(descText) {
  // 解析描述文本
  const parts = descText.split(' ')
  if (parts.length !== 2) return null

  const [_, typeLevel] = parts
  const typeMap = {
    战法: 2,
    技能: 3
  }
  const levelMap = {
    普通: 1,
    稀有: 2,
    史诗: 3
  }

  // 提取类型和等级
  const matchedType = Object.keys(typeMap).find((t) => typeLevel.includes(t))
  const matchedLevel = Object.keys(levelMap).find((l) => typeLevel.includes(l))

  if (!matchedType || !matchedLevel) return ''

  const targetType = typeMap[matchedType]
  const targetLevel = levelMap[matchedLevel]

  // 查找符合条件的物品
  const roguelikeConfig = RoguelikeConfig.GetInstance()
  for (const itemId of rogueMap.itemId) {
    const item = roguelikeConfig.getPlot(itemId)
    if (item && item.type === targetType && item.level === targetLevel) {
      return item.name
    }
  }

  return ''
}

// 处理武将信息显示
function createGeneralRow(general, difficulty, eventData) {
  const [skills, red] = highlightedSkill(general, difficulty)
  const canStart = String(eventData.CanStart || '')
    .split(';')
    .includes(String(difficulty))
  const start = general.start && canStart ? '[先行]' : ''

  return createTextRow({
    text: `${general.generalname}${start}${red ? ' ' + skills.join(' ') : ''}`,
    color: red ? STYLES.GENERAL.warning : STYLES.GENERAL.normal,
    fontSize: STYLES.GENERAL.fontSize
  })
}

const spellList = [
  '巳蛇',
  '灵动',
  '八门',
  '智迟',
  '持盈',
  '卫主',
  '不死',
  '刚烈',
  '觉醒',
  '悲鸣',
  '断肠',
  '节命',
  '先机',
  '悲鸣',
  '忘魂',
  '雅士',
  '挥泪',
  '不屈',
  '封冻',
  '灵躯',
  '武魂',
  '已蛇',
  '邪徒',
  '魅步',
  '雷击',
  '恢拓',
  '夺炁',
  '恩怨',
  '鸡肋',
  '反击'
]

function highlightedSkill(generalInfo, difficulty) {
  const difficultySpells = [
    generalInfo.getspell,
    generalInfo.getspell_ZD,
    generalInfo.getspell_KN,
    generalInfo.getspell_EM,
    generalInfo.getspell_LY
  ]

  const difficultDict = RoguelikeConfig.GetInstance().difficultDict
  const difficultyInfo = difficultDict.get(String(difficulty))
  const difficultyLevel = Number(difficultyInfo?.bdif) || 1
  const currentLevelIndex = Math.min(Math.max(difficultyLevel - 1, 0), difficultySpells.length - 1)

  const skills = difficultySpells
    .slice(0, currentLevelIndex + 1)
    .flatMap((spell) => String(spell || '').split(';'))
    .filter(Boolean)
    .map((spell) => SkillsConfig.GetInstance().getSpellName(spell))
    .filter((spell) => spellList.includes(spell))

  return [skills, skills.length > 0]
}

export function drawStore(filteredPairs) {
  var StoreHTML = document.getElementById('storeDetail')
  StoreHTML.innerText = ''

  if (filteredPairs.length == 0) filteredPairs = ['暂无集市数据']

  for (const sebs of filteredPairs) {
    const span = document.createElement('button')
    span.className = 'storeDetail'
    span.innerText = sebs
    StoreHTML.append(span)
  }
}
