import { CardConfig } from './CardConfig'
import { SkillsConfig } from './SkillsConfig'
import ConfigBase from './ConfigBase'

const ROGUE_LEVEL_KEYS = ['', '_ZD', '_KN', '_EM', '_LY']
const REWARD_QUALITY_NAMES = ['随机', '普通', '稀有', '史诗', '传说']
const CARD_SUBTYPE_NAMES = { 6: '火杀', 7: '雷杀', 11: '冰杀', 12: '闪闪' }
const CHOICE_REWARD_TYPE_NAMES = { 2: '战法', 3: '技能', 4: '手牌', 5: '装备' }
const GENERATED_JSON_REPLACEMENTS = [
  ['（', '('],
  ['）', ')'],
  ['）', ')']
]

export class RoguelikeConfig extends ConfigBase {
  pvpFileName = 'hd_1v1_rogue'
  Rplot = []
  Rcity = {}
  Rchoose = []
  Rfight = []
  rogejson = {}
  text = []
  rewards = {}
  chapterPlaces = {}
  generalGroups = {}
  season = 0
  fightEvents = new Map()

  // 兼容 configW.js 中的旧命名
  get cp() {
    return this.chapterPlaces
  }

  get gp() {
    return this.generalGroups
  }

  get sj() {
    return this.fightEvents
  }

  constructor() {
    super('Roguelike_json')
    this.FileName = 'hd_roguelike'
  }

  static GetInstance() {
    if (this.instance == null) {
      this.instance = new RoguelikeConfig()
    }

    return this.instance
  }

  parse(data) {
    if (!data) return
    this.initAbbreviation(data.root.abbreviation)
    this.decodeGenerals(data)
    this.data = data

    this.Rplot = []
    this.Rchoose = []
    this.Rfight = []
    this.fightEvents = new Map()

    const root = data.Root || {}

    this.season = root.Roundid?.reduce((_, { useSeason }) => useSeason, 0) || 0
    this.text = this.initText(root.Text)
    this.chapterPlaces = this.initChapterPlaces(root.Chapter)
    this.Rcity = this.initCities(root.Level)
    this.rewards = this.initRewards(root.RewardGroup, root.Other)
    this.initTactics(root.Tactics)

    this.initAdventures(root.Adventure)
    this.generalGroups = this.initGeneralGroups(root.General)
  }

  resolveDependencies() {
    if (!this.data) return this

    const root = this.data.Root || {}
    this.resolveSpellPlots(root.Spell)
    this.resolveCardPlots(root.Card)
    this.resolveGenerals(root.General)
    this.Rfight = this.initFights(root.Fight)
    this.fillMissingFights()
    const adventure = this.initAdventureMap(root.Adventure)
    this.Rchoose = this.initChoices(root.Choose, adventure)

    return this
  }

  initText(texts) {
    return this.arrayByKey(texts, 'ID', ({ text }) => text)
  }

  arrayByKey(list, keyField, mapValue = (item) => item) {
    const result = []

    for (const item of list || []) {
      result[item[keyField]] = mapValue(item)
    }

    return result
  }

  objectByKey(list, keyField, mapValue = (item) => item) {
    const result = {}

    for (const item of list || []) {
      result[item[keyField]] = mapValue(item)
    }

    return result
  }

  initChapterPlaces(chapters) {
    const placeMap = {}

    for (const { seasonID, chapter, cityName, bosslocation, location } of chapters || []) {
      const placeName = `${seasonID}-${chapter}${cityName}`

      for (const locationId of location?.split(';') || []) {
        placeMap[locationId] = placeName
      }

      placeMap[bosslocation] = `${placeName}BOSS`
    }

    return placeMap
  }

  initCities(levels) {
    const cityMap = {}

    for (const level of levels || []) {
      const {
        cityID: id,
        cityname,
        citypic,
        citycoordinate,
        scenespell: spell,
        scenesDesc: desc,
        startshow: boss
      } = level
      const [x, y] = this.parseCoordinate(citycoordinate)

      cityMap[id] = {
        x,
        y: -y,
        boss,
        cp: this.chapterPlaces?.[id],
        spell,
        desc,
        name: cityname ?? this.getCityNameFromPic(citypic)
      }
    }

    return cityMap
  }

  parseCoordinate(coordinate) {
    return String(coordinate || '0,0')
      .split(',')
      .map(Number)
  }

  getCityNameFromPic(citypic) {
    return citypic?.replace(/^city_([0-9]+)_(.+?)(?:\.png)?$/, (_, number, name) => number + name)
  }

  initRewards(rewardGroups, others) {
    const rewards = this.initBaseRewards(others)

    for (const rewardGroup of rewardGroups || []) {
      rewards[rewardGroup.reward] = this.formatRewardGroup(rewardGroup)
    }

    return rewards
  }

  initBaseRewards(others) {
    return this.objectByKey(others, 'reward', ({ rewardname }) => rewardname)
  }

  formatRewardGroup({ rewarddesc, allreward, abandonmoney }) {
    const moneyText = abandonmoney ? `${abandonmoney}铜币/` : ''
    const qualityText = String(allreward || '')
      .split(';')
      .flatMap((reward) => reward.split(','))
      .map((quality) => REWARD_QUALITY_NAMES[quality])
      .join('/')

    return moneyText + qualityText + rewarddesc.replace('多选一', '自选')
  }

  initTactics(tactics) {
    for (const { plot, plotname, plotdesc, school, money, level } of tactics || []) {
      this.Rplot[plot] = {
        name: plotname.replaceAll('·', ''),
        desc: plotdesc.replaceAll(' ', ''),
        school,
        money,
        level,
        type: 2
      }
    }
  }

  decodeGenerals(roge) {
    if (!roge.Root?.General) return
    roge.Root.General = roge.Root.General.map((general) => this.decodeAbbreviatedObject(general))
  }

  initAdventures(adventures) {
    for (const adventure of adventures || []) {
      adventure.chapname = this.text[adventure.chapname] ?? adventure.chapname
    }
  }

  initGeneralGroups(generals) {
    const groups = {}

    for (const general of generals || []) {
      if (!groups[general.generalgroup]) groups[general.generalgroup] = []

      general.generalname = general.generalname.replaceAll('&', '')
      groups[general.generalgroup].push(general)
    }

    return groups
  }

  resolveSpellPlots(spells) {
    for (const { id, spellid, money, level } of spells || []) {
      const spell = SkillsConfig.GetInstance().getSpell(spellid)
      this.Rplot[id] = {
        name: spell?.name,
        desc: spell?.desc,
        spellid,
        money,
        level,
        type: 3
      }
    }
  }

  resolveCardPlots(cards) {
    for (const { id, cardid, isequip, money, level } of cards || []) {
      const card = CardConfig.GetInstance().getCard(cardid)
      if (!card) continue

      this.Rplot[id] = {
        name: CARD_SUBTYPE_NAMES[card.subType] ?? card.name,
        desc: card.desc,
        color: card.color,
        number: card.number,
        money,
        level,
        type: 4 + isequip,
        rType: (card.type * 10 + card.subType) * 100 + isequip
      }
    }
  }

  resolveGenerals(generals) {
    for (const general of generals || []) {
      general.GeneralRank ||= 0
      general.next = this.resolveNextGeneral(general)
      general.info = this.createGeneralInfo(general)
      general.spells = this.collectGeneralSpells(general)
      general.zhanfas = this.collectGeneralTactics(general)
      general.cards = this.collectGeneralCards(general)
      general.spell = [
        ...general.spells.map(({ name }) => name),
        ...general.zhanfas.map(({ name }) => name)
      ].join(',')
      general.card = general.cards.map(({ ncn }) => ncn).join(',')
    }
  }

  resolveNextGeneral(general) {
    if (!general.JumpStage) return undefined

    const [rawNextGroupId, index] = general.JumpStage.split(';')
    let nextGroupId = rawNextGroupId
    if (nextGroupId.startsWith('2066')) nextGroupId -= 20000

    return this.generalGroups[nextGroupId]?.[index - 1] ?? this.generalGroups[nextGroupId]?.[0]
  }

  createGeneralInfo(general) {
    return {
      general: general.generalname,
      hp: general.hp,
      maxhp: general.maxhp,
      card: general.cardnum,
      draw: general.draw,
      sha: 1 + general.exshatimes,
      armor: general.armor,
      getarmor: general.getarmor,
      ...(general.next ? { next: general.next.generalname } : {})
    }
  }

  collectGeneralSpells(general) {
    return ROGUE_LEVEL_KEYS.flatMap((levelKey, level) =>
      this.splitIds(general['getspell' + levelKey])
        .map((spellId) => SkillsConfig.GetInstance().getSpell(spellId))
        .filter(Boolean)
        .map((spell) => ({ ...spell, level }))
    )
  }

  collectGeneralTactics(general) {
    return ROGUE_LEVEL_KEYS.flatMap((levelKey, level) =>
      this.splitIds(general['getzhanfa' + levelKey])
        .filter((plotId) => this.Rplot[plotId])
        .map((plotId) => ({
          id: plotId,
          name: this.Rplot[plotId].name + '#',
          desc: this.Rplot[plotId].desc,
          level
        }))
    )
  }

  collectGeneralCards(general) {
    return ROGUE_LEVEL_KEYS.flatMap((levelKey, level) =>
      [
        ...this.splitIds(general['carddesc' + levelKey]),
        ...this.splitIds(general['equip' + levelKey])
      ]
        .map((cardId) => CardConfig.GetInstance().getCard(cardId))
        .filter(Boolean)
        .map(({ id }) => ({ id, ncn: CardConfig.GetInstance().getCard(id)?.ncn, level }))
        .filter(({ ncn }) => ncn)
    )
  }

  splitIds(value, separator = ';') {
    return value ? String(value).split(separator) : []
  }

  initFights(fights) {
    const fightMap = []

    for (const fight of fights || []) {
      this.normalizeFight(fight)
      fightMap[fight.fightID] = fight
    }

    return fightMap
  }

  normalizeFight(fight) {
    fight.generals = [...(this.generalGroups[fight.Ggroup] ?? [])]
    fight.fight = ''
    fight.lost = ''

    this.markStartGeneral(fight)
    this.linkFightGenerals(fight)

    fight.get = this.formatFightRewards(fight)
    fight.text = this.text[fight.text] ?? fight.text
    fight.name = this.text[fight.name] ?? fight.name
  }

  markStartGeneral(fight) {
    if (!fight.startnum) return

    const startGeneral = fight.generals.find((general) => general.generalID == fight.startnum)
    if (startGeneral) startGeneral.start = true
  }

  linkFightGenerals(fight) {
    fight.generals.forEach((general, index, generals) => {
      this.linkFightGeneral(fight, general, 1, index == generals.length - 1)
    })
  }

  linkFightGeneral(fight, general, stage, isLastGeneral = false) {
    if (!general) return

    fight.fight += this.infoStr(general.info)
    fight.lost += (general.start ? '[先手]' : '') + general.generalname

    if (general.next) {
      fight.lost += '>'
      general.next.stage = stage
      general.next.info.pre = general.generalname
      fight.generals.push(general.next)
      this.linkFightGeneral(fight, general.next, stage + 1, isLastGeneral)
    } else if (!isLastGeneral) {
      fight.fight += '+'
      fight.lost += ' '
    }
  }

  formatFightRewards(fight) {
    return [
      `${fight.itemgroup}铜币`,
      ...this.splitIds(fight.rewarditem),
      ...this.splitIds(fight.reward)
    ]
      .map((rewardId, index) => (index === 0 ? rewardId : this.rewards[rewardId]))
      .join('\n')
  }

  fillMissingFights() {
    for (const groupId in this.generalGroups) {
      if (!(groupId in this.Rfight))
        this.Rfight[groupId] = { generals: this.generalGroups[groupId] }
    }
  }

  initAdventureMap(adventures) {
    return this.arrayByKey(adventures, 'ID', (adventure) => this.translateAdventureName(adventure))
  }

  translateAdventureName(adventure) {
    adventure.chapname = this.text[adventure.chapname] ?? adventure.chapname
    return adventure.chapname
  }

  initChoices(choices, adventure) {
    const choiceMap = []

    for (const choice of choices || []) {
      choiceMap[choice.effectID] = this.resolveChoice(choice, adventure)
    }

    return choiceMap
  }

  resolveChoice(choice, adventure) {
    if (choice.type == 7) return this.resolveFightChoice(choice, adventure)
    if (choice.type == 3 && choice.event1 == '2') return { get: '营地' }

    const lost = this.formatLostItem(choice)
    const get = this.formatGetItem(choice)

    return { lost, get }
  }

  resolveFightChoice(choice, adventure) {
    this.fightEvents.set(choice.event1, this.findAdventureName(choice.effectID, adventure))
    return this.Rfight[choice.event1]
  }

  findAdventureName(effectID, adventure) {
    const effectKey = String(effectID)
    return adventure[effectKey.slice(0, 4)] ?? adventure[effectKey.slice(0, 8)]
  }

  formatLostItem(choice) {
    const lost = this.item(choice.lostitem, choice.lostnum, choice.effectID)
    return lost ? '失去 ' + lost : lost
  }

  formatGetItem(choice) {
    const get = this.item(choice.getitem, choice.getnum, choice.effectID)
    return get && choice.showitem ? get.replace('随机', '特定') : get
  }

  resolveRogeJson(root, pvp) {
    if (!pvp) return

    const fightGeneralPlots = this.initFightGeneralPlots()
    this.rogejson.jsbs = JSON.stringify(this.initJsbs(root, fightGeneralPlots))
    this.rogejson.jsft = JSON.stringify(this.initJsft(fightGeneralPlots))
    this.rogejson.wscd = JSON.stringify(this.initWscd(pvp))
    this.rogejson.wssp = JSON.stringify(this.initWssp(pvp))
    this.rogejson.wszf = JSON.stringify(this.initWszf(pvp))
    this.rogejson.jssp = JSON.stringify(this.initJssp())
    this.rogejson.jscd = JSON.stringify(this.initJscd())
    this.rogejson.jssd = JSON.stringify(this.initJssd(root))
    this.rogejson.jssc = this.stringifyGeneratedJson(
      this.initJssc(root),
      GENERATED_JSON_REPLACEMENTS
    )
    this.rogejson.jszf = JSON.stringify(this.initJszf())
    this.rogejson.jstf = JSON.stringify(this.initJstf(root))
  }

  stringifyGeneratedJson(value, replacements = []) {
    return replacements.reduce(
      (text, [searchValue, replaceValue]) => text.replace(searchValue, replaceValue),
      JSON.stringify(value)
    )
  }

  initFightGeneralPlots() {
    const fightGeneralPlots = {}

    for (const [fightGroupId, generals] of Object.entries(this.generalGroups)) {
      this.collectFightGroup(fightGeneralPlots, fightGroupId, generals)
    }

    for (const [fightKey, fightGroup] of Object.entries(fightGeneralPlots)) {
      this.normalizeFightGroup(fightKey, fightGroup)
    }

    return fightGeneralPlots
  }

  collectFightGroup(fightGeneralPlots, fightGroupId, generals) {
    const fightKey = this.getFightKey(fightGroupId)
    const fightLevel = this.getFightLevel(fightGroupId)
    const fightGroup = this.ensureFightGroup(fightGeneralPlots, fightKey, fightGroupId)

    if (this.fightEvents.has(fightGroupId)) fightGroup.event = this.fightEvents.get(fightGroupId)

    for (const general of this.Rfight[fightGroupId]?.generals ?? generals) {
      this.addFightGeneral(fightGroup.generals, fightKey, fightLevel, general)
    }
  }

  ensureFightGroup(fightGeneralPlots, fightKey, fightGroupId) {
    if (!fightGeneralPlots[fightKey]) {
      fightGeneralPlots[fightKey] = {
        fight:
          this.Rfight[fightGroupId]?.name ?? this.Rfight[parseInt(fightKey) + 4000]?.name ?? '',
        generals: {}
      }
    }

    return fightGeneralPlots[fightKey]
  }

  normalizeFightGroup(fightKey, fightGroup) {
    const allLevels = Object.values(fightGroup.generals).flatMap((general) => general.levels)
    fightGroup.shift = fightKey.startsWith('*') && Math.min(...allLevels) == 1 ? 1 : 0
    fightGroup.generals = Object.values(fightGroup.generals)
      .map((general) => this.normalizeFightGeneral(general, fightGroup.shift))
      .sort((a, b) => a.level - b.level)
  }

  getFightKey(fightGroupId) {
    if (fightGroupId.length < 6) return fightGroupId.slice(-3)
    if (fightGroupId.slice(0, 2) !== '99') return fightGroupId.slice(-5, -2) + '>'
    return '*' + fightGroupId.slice(-2)
  }

  getFightLevel(fightGroupId) {
    if (fightGroupId.length < 6) return fightGroupId.slice(0, -3) - 2
    if (fightGroupId.slice(0, 2) !== '99') return fightGroupId.slice(0, -5) - 2
    return fightGroupId.slice(-3, -2) - fightGroupId.slice(-4, -3) + 9
  }

  addFightGeneral(groupedGenerals, fightKey, fightLevel, general) {
    let generalKey =
      (fightKey.startsWith('*') ? fightLevel : '') + (general.stage || '') + '#' + general.generalID
    while (true) {
      if (!groupedGenerals[generalKey]) {
        groupedGenerals[generalKey] = {
          general:
            (general.info.pre ? '>' : '') + general.generalname + (general.info.next ? '>' : ''),
          info: this.infoStr(general.info),
          levels: [],
          start: [],
          infos: {},
          spell: {},
          card: {},
          ad: {}
        }
      } else if (groupedGenerals[generalKey].levels.includes(fightLevel)) {
        generalKey += '@'
        continue
      }
      break
    }

    const groupedGeneral = groupedGenerals[generalKey]
    if (fightLevel % 10 < 6 && fightLevel < 20) {
      groupedGeneral.levels.push(fightLevel)
      if (general.start) groupedGeneral.start.push(fightLevel)
    }
    groupedGeneral.infos[fightLevel] = general.info
    if (general.otherad) groupedGeneral.ad[fightLevel] = general.otherad
    general.spells?.forEach((spell) => {
      if (!groupedGeneral.spell[spell.spellid])
        groupedGeneral.spell[spell.spellid] = { ...spell, levels: [], level: undefined }
      if (fightLevel % 10 < 6 && fightLevel < 20)
        groupedGeneral.spell[spell.spellid].levels.push(fightLevel + (spell.level ?? 0))
    })
    general.cards?.forEach((card) => {
      if (!groupedGeneral.card[card.id])
        groupedGeneral.card[card.id] = { name: card.ncn, levels: [], level: undefined }
      if (fightLevel % 10 < 6 && fightLevel < 20)
        groupedGeneral.card[card.id].levels.push(fightLevel + (card.level ?? 0))
    })
  }

  normalizeFightGeneral(g, shift) {
    g.level = Math.min(...g.levels.sort((a, b) => b - a)) - shift
    g.spell = Object.values(g.spell)
      .map((s) => this.normalizeLevelItem(s, g.levels, shift, true))
      .sort(this.sortLevelItem)
    g.card = Object.values(g.card)
      .map((c) => this.normalizeLevelItem(c, g.levels, shift))
      .sort(this.sortLevelItem)
    if (!g.card.length) delete g.card
    g.info = Object.values(g.infos).reduce(
      (acc, i) => {
        Object.keys(acc).forEach((k) => {
          if (i[k] > acc[k]) acc[k] = i[k]
        })
        return acc
      },
      { hp: 0, card: 0, draw: 0, sha: 0 }
    )
    if (Object.keys(g.ad).length) {
      Object.keys(g.ad)
        .sort((a, b) => b - a)
        .forEach((lv, i, a) => {
          if ((lv >= 10 && g.ad[lv] == g.ad[lv % 10]) || g.ad[lv] == g.ad[a[i + 1]]) delete g.ad[lv]
        })
    } else delete g.ad
    if (g.start.length) g.start = Math.min(...g.start)
    else delete g.start
    delete g.infos
    delete g.levels
    return g
  }

  normalizeLevelItem(item, generalLevels, shift, isSpell = false) {
    const lv = Math.min(...item.levels.sort((a, b) => b - a))
    if (
      item.levels.some(
        (l, i, a) =>
          l < 10 &&
          !a.includes(l + 10) &&
          (generalLevels.includes(l + 10) ||
            (generalLevels.length == 2 && generalLevels.includes(10)))
      )
    ) {
      item.level = [lv]
    }
    if (item.levels.some((l) => l < 10)) {
      const diffEliteLevels = item.levels.filter((l, i, a) => l >= 10 && !a.includes(l - 10))
      if (diffEliteLevels.length) item.level = [lv, diffEliteLevels[diffEliteLevels.length - 1]]
    }
    item.level = (item.level ?? lv) - shift
    delete item.levels
    if (isSpell) delete item.spellid
    return item
  }

  sortLevelItem(a, b) {
    const f = (l) => (l[1] >= 10 ? l[1] : (l[0] ?? l))
    return (f(a.level) % 10) - (f(b.level) % 10) || f(a.level) - f(b.level)
  }

  initJsbs(root, fightGeneralPlots) {
    const universalFightGroups = (root.UniversalGroup || [])
      .filter((item) => item.fightgroup !== undefined)
      .reduce((acc, item) => {
        if (!acc[item.fightID]) acc[item.fightID] = {}
        const fightKey = String(item.fightgroup).slice(-3)
        if (!acc[item.fightID][fightKey]) acc[item.fightID][fightKey] = []
        acc[item.fightID][fightKey].push(item)
        return acc
      }, {})

    const cityFightGroups = Array.from(
      Array.from(
        (root.Level || [])
          .reduce((acc, { cityID, eventfight, universalfight }) => {
            const addFightCity = (fightKey) => {
              if (!fightKey || fightKey.length == 0) return
              const cityNames = acc.get(fightKey)
              if (!cityNames) acc.set(fightKey, [this.chapterPlaces[cityID]])
              else if (!cityNames.includes(this.chapterPlaces[cityID]))
                cityNames.push(this.chapterPlaces[cityID])
            }

            addFightCity(universalfight)

            addFightCity(
              eventfight
                ?.split(';')
                ?.map((fightKey) => fightKey.slice(-3))
                ?.filter((fightKey, index, allKeys) => !allKeys.slice(index + 1).includes(fightKey))
            )
            return acc
          }, new Map())
          .entries()
      )
        .reduce((acc, [groupKey, cityNames]) => {
          const cityKey =
            cityNames.length > 1 &&
            new Set(cityNames.map((cityName) => cityName.slice(0, 3))).size < 2
              ? cityNames.map((cityName, index) => cityName.slice(index ? 3 : 0)).join('/')
              : String(cityNames)
          if (!acc.get(cityKey)) acc.set(cityKey, new Set())
          const fightKeys = universalFightGroups[groupKey]
            ? Object.keys(universalFightGroups[groupKey])
            : groupKey
          for (const fightKey of fightKeys) {
            acc.get(cityKey).add(fightKey)
          }
          return acc
        }, new Map())
        .entries()
    ).reduce((acc, [cityKey, fightKeys]) => {
      acc[cityKey] = Array.from(fightKeys, (fightKey) => fightGeneralPlots[fightKey])
      return acc
    }, {})

    return Object.entries(cityFightGroups)
      .filter(([cityKey]) => cityKey.includes(this.season + '-'))
      .reduce((acc, [cityKey, fightGroups]) => {
        const shortCityKey = cityKey.slice(2)
        if (!acc[shortCityKey]) acc[shortCityKey] = []
        fightGroups.forEach((fightGroup) => {
          if (fightGroup.fight != '新年大吉') acc[shortCityKey].push(fightGroup)
        })
        return acc
      }, {})
  }

  initJsft(fgp) {
    return Object.values(fgp)
      .filter(
        (p) =>
          (['天涯故交', '招兵买马', '万众敬仰'].includes(p.event) && p.shift) ||
          ['突来危机', '擂台比武', '战事推演', '为民除害', '赛前演习', '宵小叫嚣'].includes(p.event)
      )
      .reduce((acc, { event, generals, fight }) => {
        if (!acc[event]) acc[event] = []
        acc[event].push({ ...(fight ? { fight } : {}), generals })
        return acc
      }, {})
  }

  initWscd(pvp) {
    return Object.values(
      (pvp.Card || [])
        .map(({ CitationID, money }) => ({ ...this.Rplot[CitationID], money }))
        .reduce((acc, { level, money, name, color, number, desc, rType }) => {
          const k = level + name + number
          if (!acc[k]) acc[k] = { cl: [], level: money, name, number, type: rType, desc }
          acc[k].cl.push(color)
          return acc
        }, {})
    ).sort(msort('type', 'level'))
  }

  initWssp(pvp) {
    return (pvp.Spell || [])
      .map(({ CitationID, money }) => ({ ...this.Rplot[CitationID], money }))
      .sort(msort('money', 'level', 'spellid'))
      .map(({ money, name, desc }) => ({ level: money, name, desc }))
  }

  initWszf(pvp) {
    return (pvp.Tactics || [])
      .map(({ CitationID, money }) => ({ ...this.Rplot[CitationID], money }))
      .filter(
        (e) =>
          (e.name = e.name?.replace('·新', '')) &&
          !e.name.includes('废弃') &&
          !e.desc.includes('备用') &&
          !/(游戏|战斗)开始/.test(e.desc)
      )
      .sort((a, b) =>
        !a.money ^ !b.money
          ? !a.money
            ? -1
            : 1
          : a.name.slice(0, 2).localeCompare(b.name.slice(0, 2)) != 0
            ? a.name.slice(0, 2).localeCompare(b.name.slice(0, 2))
            : msort('money', 'level', 'name.length')(a, b)
      )
      .map(({ money, name, desc }) => ({ level: money, name, desc }))
      .filter((v, i, a) => JSON.stringify(v) != JSON.stringify(a[i + 1]))
  }

  initJssp() {
    return this.Rplot.filter((p) => p?.type == 3)
      .sort(msort('level', 'money', 'spellid'))
      .map(({ level, name, desc }) => ({ name, level, desc }))
  }

  initJscd() {
    return Object.values(
      this.Rplot.filter((p) => p?.type >= 4).reduce(
        (acc, { level, money, name, color, number, desc, rType }) => {
          const k = level + name + number
          const d = [33, 34].includes(Math.floor(rType / 100)) || (name == '诸葛连弩' && level == 4)
          if (!acc[k])
            acc[k] = {
              cl: [],
              level: d ? 0 : level,
              money,
              name,
              number,
              type: rType + (d ? 6 : 0),
              desc
            }
          acc[k].cl.push(color)
          return acc
        },
        {}
      )
    )
      .sort(msort('type', 'level', 'money'))
      .sort((a, b) => (a.level > 0 && b.level == 0 ? -1 : 0))
  }

  initJssd(root) {
    return (root.seed || [])
      .sort(msort('level', 'seed'))
      .map(({ name, desc, level, _huchijineng }) => {
        // const jineng = desc?.match(/.*获得【([^【】]*)】.*/)?.[1]

        // if (jineng) {
        //   const dict = SkillsConfig.GetInstance().spellDict
        //   desc += dict[huchijineng]?.desc || dict.find((s) => s?.name == jineng)?.desc || ''
        // }

        return { name, level, desc }
      })
  }

  initJssc(root) {
    return (root.school || []).map(
      ({ school, name, effect, needputong, needxiyou, needshishi, needchuanshuo }) => ({
        school,
        name,
        need: [needputong, needxiyou, needshishi, needchuanshuo],
        desc: this.Rplot[effect].desc.replaceAll(' ', '')
      })
    )
  }

  initJszf() {
    return this.Rplot.filter((p) => p?.type == 2)
      .filter((e) => {
        e.school = parseInt(e.school || 100)
        e.name = e.name.replace('·新', '')
        return !e.name.includes('废弃') && !e.desc.includes('备用') && !e.name.includes('套装')
      })
      .sort((a, b) =>
        a.name.slice(0, 2).localeCompare(b.name.slice(0, 2)) != 0
          ? a.name.slice(0, 2).localeCompare(b.name.slice(0, 2))
          : msort('level', 'money', 'name.length')(a, b)
      )
      .map(({ level, name, desc, school }) => ({
        ...(school < 100 ? { school } : {}),
        name,
        level,
        desc
      }))
      .filter((v, i, a) => JSON.stringify(v) != JSON.stringify(a[i + 1]))
  }

  initJstf(root) {
    return (root.saijitianfu || [])
      .filter((e) => e.seasonID == this.season)
      .reduce(
        (acc, { tfid: id, ceng: y, type: x, cost, plot, preposition }) => {
          acc[id] = { id, x, y, cost, pre: preposition?.split(/,|;/) ?? [], ...this.Rplot[plot] }
          return acc
        },
        [{ id: 0, x: 0, y: 0, cost: 0, pre: [], name: '', level: 0, type: 0 }]
      )
  }

  item(id, num, effect) {
    if (!id) return ''
    if (String(id).includes(',')) return this.formatQualityReward(id)
    if (this.rewards[id]) return (num > 1 ? num : '') + this.rewards[id]
    if (this.Rplot[id]) return this.Rplot[id]?.name
    if (this.generalGroups[id]) return this.formatGeneralGroupReward(id, effect)

    return this.data.Root.Card.find((card) => card.id == id)?.name
  }

  formatQualityReward(id) {
    const [type, quality] = String(id).split(',')
    return REWARD_QUALITY_NAMES[quality] + CHOICE_REWARD_TYPE_NAMES[type]
  }

  formatGeneralGroupReward(groupId, effect) {
    const adventureName = this.data.Root.Adventure.find(
      (adventure) => adventure.ID === parseInt(effect / 10)
    )?.chapname

    this.fightEvents.set(groupId, adventureName)
    return this.generalGroups[groupId].map((general) => general.generalname).join('\n')
  }

  infoStr({ general, hp, maxhp, card, draw, sha, next, pre }) {
    return (
      (pre ? '>' : '') +
      general +
      hp +
      (maxhp !== hp ? '/' + maxhp : '') +
      '血' +
      card +
      '牌摸' +
      draw +
      '杀' +
      sha +
      (next ? '>' : '')
    )
  }

  decodeAbbreviatedObject(obj) {
    if (typeof obj !== 'object') return obj

    const decoded = {}
    for (const [shortKey, value] of Object.entries(obj)) {
      const longKey = this.shortToLongObj[shortKey] || shortKey
      decoded[longKey] = value
    }
    return decoded
  }
}

function msort(...fields) {
  return (left, right) => {
    for (const field of fields) {
      const diff = getByPath(left, field) - getByPath(right, field)
      if (diff) return diff
    }

    return 0
  }
}

function getByPath(value, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], value)
}
