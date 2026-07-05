import { RoguelikeConfig, SkillsConfig } from '@/config'
import { rogueMap } from '@/tracker'
import { laya } from '@/runtime/gameAdapter'
import { wait } from '@/utils'

export function drawCitiesUI(cities, _display) {
  rogueMap.res = []

  for (const city of cities) {
    const { x, y } = RoguelikeConfig.GetInstance().Rcity[city.id]
    let containerHeight = 0

    // 创建容器
    const cityContainer = new Laya.VBox()
    cityContainer.pos(x, y)
    cityContainer.zOrder = 999
    cityContainer.name = 'city'

    // 创建背景
    const background = new Laya.Sprite()
    background.alpha = 0.7
    cityContainer.addChild(background)

    const fight = RoguelikeConfig.GetInstance().Rfight[city.event]

    if (fight) {
      // 战斗事件处理
      containerHeight = processFightEvent(
        {
          ...fight,
          event: city.event
        },
        cityContainer
      )
    } else {
      containerHeight += processChooseEvent(city.event, cityContainer)
    }

    // 设置容器布局
    setupCityContainer(cityContainer, background, containerHeight)
    rogueMap.res.push({ id: city.id, city: cityContainer })
  }

  // 更新场景显示
  wait(() => laya.find('SceneLayer', 'RogueSmallMapScene')).then((rogueScene) => {
    // 清理旧内容
    for (let i = rogueScene?.cityView.numChildren - 1; i >= 0; i--) {
      const child = rogueScene.cityView.getChildAt(i)
      if (child.name === 'city' && rogueScene.cityView) {
        rogueScene.cityView.removeChild(child)
      }
    }

    // 添加新内容
    if (rogueScene?.cityView && cities) {
      rogueMap.res.forEach(({ city }) => {
        rogueScene.cityView.addChild(city)
      })
    }
  })
}
// 样式常量
const STYLES = {
  TITLE: { color: '#f2de9c', fontSize: 20, bold: true },
  HR: { text: '--------------------', color: '#ccc', fontSize: 15 },
  GENERAL: { normal: '#f2de9c', warning: 'rgb(240, 65, 85)', fontSize: 20 },
  GET_INFO: { color: '#f2de9c', fontSize: 20, bold: true }
}

// 创建通用标签组件
function createLabel(config) {
  const label = new Laya.Label()
  label.text = config.text || ''
  label.color = config.color || '#ffffff'
  label.fontSize = config.fontSize || 16
  label.bold = config.bold || false
  label.align = 'center'
  label.valign = 'middle'

  label.width = 210 // 新增宽度设置
  return label
}

// 创建水平分割线
function createHrLine() {
  return createLabel({
    text: STYLES.HR.text,
    color: STYLES.HR.color,
    fontSize: STYLES.HR.fontSize,
    bold: false
  })
}

// 处理武将信息显示
function createGeneralLabel(los, difficulty) {
  const [skills, red] = highlightedSkill(los, difficulty)
  const start = los.start ? '[先行]' : ''
  return createLabel({
    text: `${los.generalname}${start}${red ? ' ' + skills.join(' ') : ''}`,
    color: red ? STYLES.GENERAL.warning : STYLES.GENERAL.normal,
    fontSize: STYLES.GENERAL.fontSize,
    bold: true
  })
}

// 初始化容器布局
function setupCityContainer(container, background, height) {
  container.layoutEnabled = true
  container.vScrollBarSkin = ''
  background.graphics.clear()
  background.graphics.drawRect(0, 0, 210, height, '#3B3A27')
  background.pos(0, 0)
}

// 处理战斗事件内容
function processFightEvent(eventData, cityContainer) {
  let height = 0

  // 处理武将列表
  eventData.generals.forEach((los) => {
    const generalLabel = createGeneralLabel(los, rogueMap.difficulty)
    cityContainer.addChild(generalLabel)
    height += generalLabel.height
  })

  const hrLine1 = createHrLine()
  cityContainer.addChild(hrLine1)
  height += hrLine1.height
  // 添加获取信息
  const getLabel = createLabel({
    text: eventData.get,
    ...STYLES.GET_INFO
  })

  cityContainer.addChild(getLabel)
  height += getLabel.height

  return height
}

// 处理选择事件内容
function processChooseEvent(baseEvent, cityContainer) {
  let totalHeight = 0

  for (let j = 0; j < 3; j++) {
    const event1 = baseEvent + (j + 1).toString() // 不补零，如 "event1"
    const event2 = baseEvent + (j + 1).toString().padStart(2, '0') // 补零，如 "event01"
    // console.info(event1, event2);
    const event = RoguelikeConfig.GetInstance().Rchoose[event2] ? event2 : event1
    // console.info(initMap.Rchoose[event1], initMap.Rchoose[event2])
    if (!RoguelikeConfig.GetInstance().Rchoose[event]) continue

    const eventData = RoguelikeConfig.GetInstance().Rchoose[event]

    // 处理武将选项
    if (eventData.generals) {
      eventData.generals.forEach((los) => {
        const generalLabel = createGeneralLabel(los, rogueMap.difficulty)
        cityContainer.addChild(generalLabel)
        totalHeight += generalLabel.height
      })
    }

    // 添加获取信息
    const textParts = []
    if (!eventData.generals && eventData.lost)
      textParts.push(`${eventData.lost} ${findLostItemByName(eventData.lost)}`)
    if (eventData.get) textParts.push(`${eventData.get}`)

    if (textParts.length > 0) {
      const getLabel = createLabel({
        text: textParts.join('\n'),
        ...STYLES.GET_INFO
      })
      cityContainer.addChild(getLabel)
      totalHeight += getLabel.height
    }

    // 添加分割线
    const hrLine = createHrLine()
    cityContainer.addChild(hrLine)
    totalHeight += hrLine.height
  }

  return totalHeight
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
  for (const itemId of rogueMap.itemId) {
    const item = RoguelikeConfig.GetInstance().Rplot[itemId]
    if (item && item.type === targetType && item.level === targetLevel) {
      return item.name
    }
  }

  return ''
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

const spellPriority = {
  getspell: 0,
  getspell_ZD: 1,
  getspell_KN: 2,
  getspell_EM: 3,
  getspell_LY: 4
}

function highlightedSkill(generalInfo, difficulty) {
  const skills = []
  let red = false
  const spellDifficulty = getSpellDifficulty(difficulty)
  const spellPriorityLevel = spellPriority[spellDifficulty]

  // 遍历 spellPriority 对象，累加符合优先级条件的 spell 字符串
  let diffSkill = Object.keys(spellPriority)
    .filter((spell) => spellPriority[spell] <= spellPriorityLevel) // 筛选出符合优先级的 spells
    .map((spell) => generalInfo[spell]) // 获取每个 spell 对应的值
    .filter(Boolean) // 过滤掉 undefined 或 null 的值
    .join(';') // 用分号合并所有符合条件的值

  // 可能会出现无收录技能，如1053
  diffSkill = diffSkill?.split(';').map((skill) => SkillsConfig.GetInstance().getSpellName(skill))

  for (const ds of diffSkill) {
    if (spellList.includes(ds)) {
      skills.push(ds)
      red = true
    }
  }

  return [skills, red]
}

function getSpellDifficulty(difficulty) {
  switch (Math.floor((difficulty - 1) / 5)) {
    case 0:
      return 'getspell'
    case 1:
      return 'getspell_ZD'
    case 2:
      return 'getspell_KN'
    case 3:
      return 'getspell_EM'
    case 4:
      return 'getspell_LY'
    default:
      return 'getspell'
  }
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
