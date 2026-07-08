import { CardConfig } from './CardConfig'
import { SkillsConfig } from './SkillsConfig'
import ConfigBase from './ConfigBase'

const ROGUE_LEVEL_KEYS = ['', '_ZD', '_KN', '_EM', '_LY']
const REWARD_QUALITY_NAMES = ['随机', '普通', '稀有', '史诗', '传说']
const CARD_SUBTYPE_NAMES = { 6: '火杀', 7: '雷杀', 11: '冰杀', 12: '闪闪' }
const CHOICE_REWARD_TYPE_NAMES = { 2: '战法', 3: '技能', 4: '手牌', 5: '装备' }

export class RoguelikeConfig extends ConfigBase {
  originData = null
  /** 战法 技能 卡牌 */
  shopDict = new Map()
  /** 城市进度 */
  levelDict = new Map()
  /** 奇遇选项结果 */
  adventureResultDict = new Map()
  /** 战斗事件 */
  fightDict = new Map()
  /** 奇遇数据 */
  adventures = new Map()
  text = new Map()
  /** 奖励 */
  rewardGroupDict = new Map()
  /** 章节地点 */
  chapterDict = new Map()
  /** 敌人数据 */
  generalDict = new Map()
  season = 0

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

  clearRuntimeMaps() {
    this.shopDict.clear()
    this.levelDict.clear()
    this.adventureResultDict.clear()
    this.fightDict.clear()
    this.adventures.clear()
    this.text.clear()
    this.rewardGroupDict.clear()
    this.chapterDict.clear()
    this.generalDict.clear()
    this.season = 0
  }

  getPlot(id) {
    const plot = this.shopDict.get(String(id))
    return plot ? this.resolvePlot(plot) : plot
  }

  getCity(id) {
    return this.levelDict.get(String(id))
  }

  getChoice(id) {
    const choice = this.adventureResultDict.get(String(id))
    return choice ? this.resolveChoice(choice) : choice
  }

  getFight(id) {
    const fight = this.fightDict.get(String(id))
    if (fight) return this.normalizeFight(fight)

    const generals = this.getGeneralGroup(id)
    return generals ? this.normalizeFight({ fightID: id, generals }) : undefined
  }

  getAdventure(id) {
    return this.adventures.get(String(id))
  }

  getReward(id) {
    return this.rewardGroupDict.get(String(id))
  }

  getRewardText(id) {
    const reward = this.getReward(id)
    if (!reward) return ''
    if (reward.name) return reward.name
    return this.formatRewardGroup(reward)
  }

  getGeneralGroup(id) {
    return this.generalDict.get(String(id))
  }

  parse(data) {
    if (!data) return
    this.initAbbreviation(data.root.abbreviation)
    this.decodeGenerals(data)
    this.data = data
    const root = data.Root || {}
    this.originData = root
    this.clearRuntimeMaps()

    this.season = root.Roundid?.[root.Roundid.length - 1]?.useSeason || 0
    this.initText(root.Text)
    this.initChapterPlaces(root.Chapter)
    this.initCities(root.Level)
    this.initRewards(root.RewardGroup, root.Other)
    this.initTactics(root.Tactics)
    this.initSpellPlots(root.Spell)
    this.initCardPlots(root.Card)

    this.initAdventures(root.Adventure)
    this.initGeneralGroups(root.General)
    this.initFights(root.Fight)
    this.initChoices(root.Choose)
  }

  initText(texts) {
    for (const { ID, text } of texts || []) {
      this.text.set(String(ID), text)
    }
  }

  initChapterPlaces(chapters) {
    for (const { seasonID, chapter, cityName, bosslocation, location } of chapters || []) {
      const placeName = `${seasonID}-${chapter}${cityName}`

      for (const locationId of location?.split(';') || []) {
        this.chapterDict.set(String(locationId), placeName)
      }

      this.chapterDict.set(String(bosslocation), `${placeName}BOSS`)
    }
  }

  initCities(levels) {
    for (const level of levels || []) {
      const city = this.parseCity(level)
      this.levelDict.set(String(city.cityID), city)
    }
  }

  parseCity(level) {
    const cityID = level.cityID || 0
    const cityPos = this.parseCoordinate(level.citycoordinate)
    const [x, y] = cityPos
    const eventFightKeys = this.splitIds(level.eventfight).map((fightKey) =>
      String(fightKey).slice(-3)
    )
    const eventfights = eventFightKeys.map(Number)
    const cityName = level.cityname || ''

    return {
      cityID,
      CityID: cityID,
      cityName,
      CityName: cityName,
      cityPos,
      CityPos: cityPos,
      citypic: level.citypic || '',
      eventfights,
      Eventfights: eventfights,
      eventFightKeys,
      eventfight: eventfights[0] || 0,
      Eventfight: eventfights[0] || 0,
      universalfight: level.universalfight || '',
      startShow: level.startshow == 1,
      StartShow: level.startshow == 1,
      scene: level.scene || '',
      spell: level.scenespell,
      desc: level.scenesDesc,
      cp: this.chapterDict.get(String(cityID)),
      x,
      y: -y,
      boss: level.startshow,
      name: cityName || this.getCityNameFromPic(level.citypic)
    }
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
    for (const otherReward of others || []) {
      const reward = this.parseOtherReward(otherReward)
      this.rewardGroupDict.set(String(reward.id), reward)
    }

    for (const rewardGroup of rewardGroups || []) {
      const reward = this.parseRewardGroup(rewardGroup)
      this.rewardGroupDict.set(String(reward.id), reward)
    }
  }

  parseOtherReward({ reward, rewardname }) {
    return {
      id: reward || 0,
      rewardID: reward || 0,
      name: rewardname || ''
    }
  }

  parseRewardGroup(rewardGroup) {
    return {
      id: rewardGroup.reward || 0,
      rewardID: rewardGroup.reward || 0,
      allreward: rewardGroup.allreward || '',
      rewardIcon: rewardGroup.rewardicon || '',
      toppic: rewardGroup.toppic || '',
      goodsId: rewardGroup.goods || 0,
      quality: rewardGroup.quality || 0,
      rewarddesc: rewardGroup.rewarddesc || '',
      rewarditem: rewardGroup.rewarditem || '',
      random: rewardGroup.random || 0,
      showpic: rewardGroup.showpic || '',
      pra1: rewardGroup.pra1 || 0,
      pra2: rewardGroup.pra2 || 0,
      type: rewardGroup.type || 0,
      abandonmoney: rewardGroup.abandonmoney || 0
    }
  }

  formatRewardGroup({ rewarddesc, allreward, abandonmoney }) {
    const moneyText = abandonmoney ? `${abandonmoney}铜币/` : ''
    const qualityText = String(allreward || '')
      .split(';')
      .flatMap((reward) => reward.split(','))
      .map((quality) => REWARD_QUALITY_NAMES[quality])
      .join('/')

    return moneyText + qualityText + String(rewarddesc || '').replace('多选一', '自选')
  }

  initTactics(tactics) {
    for (const tactic of tactics || []) {
      this.shopDict.set(String(tactic.plot), {
        source: 'tactic',
        ...tactic
      })
    }
  }

  initSpellPlots(spells) {
    for (const spell of spells || []) {
      this.shopDict.set(String(spell.id), {
        source: 'spell',
        ...spell
      })
    }
  }

  initCardPlots(cards) {
    for (const card of cards || []) {
      this.shopDict.set(String(card.id), {
        source: 'card',
        ...card
      })
    }
  }

  decodeGenerals(roge) {
    if (!roge.Root?.General) return
    roge.Root.General = roge.Root.General.map((general) => this.decodeAbbreviatedObject(general))
  }

  initAdventures(adventures) {
    for (const adventure of adventures || []) {
      this.adventures.set(String(adventure.ID), this.parseAdventure(adventure))
    }
  }

  parseAdventure(adventure) {
    const id = adventure.ID || 0
    const textIds = this.splitIds(adventure.text)

    return {
      id,
      ID: id,
      chapname: adventure.chapname || '',
      duration: adventure.duration || 0,
      text: adventure.text || '',
      textIds,
      helptext: String(adventure.helptext || 0),
      showrole: adventure.showrole || '',
      mirror: adventure.mirror || 0,
      general: adventure.general,
      words: adventure.words,
      options: this.parseAdventureOptions(adventure)
    }
  }

  parseAdventureOptions(adventure) {
    const options = []

    // 哪个B设计出这样的数据结构害人不浅
    // 还不使用 while
    for (let index = 1; index < 10; index++) {
      const option = adventure['option' + index]
      const effect = adventure['effect' + index]
      if (!option || !effect) break

      options.push({
        option,
        effect,
        effecttext: adventure['effecttext' + index] || 0,
        effectvalue: adventure['effectvalue' + index] || ''
      })
    }

    return options
  }

  getText(textId) {
    return this.text.get(String(textId)) ?? textId
  }

  initGeneralGroups(generals) {
    for (const generalData of generals || []) {
      const general = this.parseGeneral(generalData)
      const groupId = general.generalgroup
      const groupKey = String(groupId)
      if (!this.generalDict.has(groupKey)) this.generalDict.set(groupKey, [])
      this.generalDict.get(groupKey).push(general)
    }
  }

  parseGeneral(general) {
    const generalgroup = general.generalgroup || 0
    const generalID = general.generalID || 0
    const generalname = String(general.generalname || '').replaceAll('&', '')
    const jumpStage = this.parseGeneralJumpStage(general.JumpStage)
    const growdouble = this.parseGeneralRatio(general.growdouble)
    const growshowdouble = this.parseGeneralRatio(general.growshowdouble)
    const diffdouble = this.parseGeneralRatio(general.diffdouble)
    const deleteSpell = this.splitIds(general.deletespell).map(Number)
    const inStage = general.inStage || 0
    const hasNextStage = inStage > 0 && jumpStage.id > 0
    const isboss = general.isboss == 1

    return {
      generalgroup,
      GeneralGroup: generalgroup,
      generalID,
      GeneralID: generalID,
      generalname,
      GeneralName: generalname,
      generalskin: general.generalskin || 0,
      Generalskin: general.generalskin || 0,
      generalcounty: general.generalcounty || 0,
      Generalcounty: general.generalcounty || 0,
      growdouble,
      Growdouble: growdouble,
      growshowdouble,
      Growshowdouble: growshowdouble,
      diffdouble,
      Diffdouble: diffdouble,
      hp: general.hp || 0,
      Hp: general.hp || 0,
      maxhp: general.maxhp || 0,
      MaxHp: general.maxhp || 0,
      armor: general.armor || 0,
      Armor: general.armor || 0,
      maxarmor: general.maxarmor || 0,
      Maxarmor: general.maxarmor || 0,
      getarmor: general.getarmor || 0,
      draw: general.draw || 0,
      DrawCnt: general.draw || 0,
      cardnum: general.cardnum || 0,
      CardNum: general.cardnum || 0,
      exshatimes: general.exshatimes || 0,
      ExShaTimes: general.exshatimes || 0,
      otherad: general.otherad || 0,
      Otherad: general.otherad || 0,
      isboss,
      IsBoss: isboss,
      deleteSpell,
      DeleteSpell: deleteSpell,
      JumpStage: general.JumpStage || '',
      jumpStage,
      jumpStageId: jumpStage.id,
      JumpstageId: jumpStage.id,
      jumpStageIndex: jumpStage.index,
      JumpstageIndex: jumpStage.index,
      inStage,
      InStage: inStage,
      hasNextStage,
      HasNextStage: hasNextStage,
      hide: general.hide,
      Hide: general.hide,
      GeneralRank: general.GeneralRank || 0,
      ...this.copyGeneralLevelFields(general)
    }
  }

  parseGeneralRatio(value) {
    return value != null ? value / 100 : 1
  }

  parseGeneralJumpStage(jumpStage) {
    const [rawNextGroupId, rawIndex] = this.splitIds(jumpStage)
    if (!rawNextGroupId) return { raw: '', id: 0, index: 0 }

    let nextGroupId = rawNextGroupId
    if (String(nextGroupId).startsWith('2066')) nextGroupId -= 20000

    return {
      raw: jumpStage || '',
      id: Number(nextGroupId) || 0,
      index: Number(rawIndex) || 0
    }
  }

  copyGeneralLevelFields(general) {
    const fields = {}

    for (const levelKey of ROGUE_LEVEL_KEYS) {
      fields['getspell' + levelKey] = general['getspell' + levelKey] || ''
      fields['getzhanfa' + levelKey] = general['getzhanfa' + levelKey] || ''
      fields['carddesc' + levelKey] = general['carddesc' + levelKey] || ''
      fields['equip' + levelKey] = general['equip' + levelKey] || ''
    }

    return fields
  }

  resolvePlot(plot) {
    if (plot.source == 'tactic') {
      return {
        name: plot.plotname.replaceAll('·', ''),
        desc: plot.plotdesc.replaceAll(' ', ''),
        school: plot.school,
        money: plot.money,
        level: plot.level,
        type: 2
      }
    }

    if (plot.source == 'spell') {
      const spell = SkillsConfig.GetInstance().getSpell(plot.spellid)
      return {
        name: spell?.name,
        desc: spell?.desc,
        spellid: plot.spellid,
        money: plot.money,
        level: plot.level,
        type: 3
      }
    }

    if (plot.source == 'card') {
      const card = CardConfig.GetInstance().getCard(plot.cardid)
      if (!card) return undefined
      return {
        name: CARD_SUBTYPE_NAMES[card.subType] ?? card.name,
        desc: card.desc,
        color: card.color,
        number: card.number,
        money: plot.money,
        level: plot.level,
        type: 4 + plot.isequip,
        rType: (card.type * 10 + card.subType) * 100 + plot.isequip
      }
    }

    return plot
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

  splitIds(value, separator = ';') {
    return value ? String(value).split(separator) : []
  }

  initFights(fights) {
    for (const fight of fights || []) {
      this.fightDict.set(String(fight.fightID), fight)
    }
  }

  normalizeFight(fight) {
    const normalizedFight = {
      ...fight,
      generals: (fight.generals ?? this.getGeneralGroup(fight.Ggroup) ?? [])
        .map((general) => this.cloneFightGeneral(general))
        .filter(Boolean),
      fight: '',
      lost: ''
    }

    this.markStartGeneral(normalizedFight)
    this.linkFightGenerals(normalizedFight)

    normalizedFight.get = this.formatFightRewards(fight)
    normalizedFight.text = this.getText(fight.text)
    normalizedFight.name = this.getText(fight.name)

    return normalizedFight
  }

  cloneFightGeneral(general, used = new Set()) {
    if (!general || used.has(general)) return undefined

    used.add(general)
    const nextGroup = general.jumpStageId ? this.getGeneralGroup(general.jumpStageId) : undefined
    const nextGeneral = nextGroup?.[general.jumpStageIndex - 1] ?? nextGroup?.[0]
    const clonedGeneral = {
      ...general
    }
    if (nextGeneral) clonedGeneral.next = this.cloneFightGeneral(nextGeneral, used)
    clonedGeneral.info = this.createGeneralInfo(clonedGeneral)

    return clonedGeneral
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
    if (!fight.itemgroup && !fight.rewarditem && !fight.reward) return ''

    return [
      ...(fight.itemgroup ? [`${fight.itemgroup}铜币`] : []),
      ...this.splitIds(fight.rewarditem),
      ...this.splitIds(fight.reward)
    ]
      .map((rewardId, index) =>
        index === 0 && fight.itemgroup ? rewardId : this.getRewardText(rewardId)
      )
      .join('\n')
  }

  initChoices(choices) {
    for (const choice of choices || []) {
      this.adventureResultDict.set(String(choice.effectID), choice)
    }
  }

  resolveChoice(choice) {
    if (choice.type == 7) return this.resolveFightChoice(choice)
    if (choice.type == 3 && choice.event1 == '2') return { get: '营地' }

    const lost = this.formatLostItem(choice)
    const get = this.formatGetItem(choice)

    return { lost, get }
  }

  resolveFightChoice(choice) {
    return this.getFight(choice.event1)
  }

  formatLostItem(choice) {
    const lost = this.item(choice.lostitem, choice.lostnum, choice.effectID)
    return lost ? '失去 ' + lost : lost
  }

  formatGetItem(choice) {
    const get = this.item(choice.getitem, choice.getnum, choice.effectID)
    return get && choice.showitem ? get.replace('随机', '特定') : get
  }

  item(id, num, effect) {
    if (!id) return ''
    if (String(id).includes(',')) return this.formatQualityReward(id)
    if (this.getReward(id)) return (num > 1 ? num : '') + this.getRewardText(id)
    const plot = this.getPlot(id)
    if (plot) return plot.name
    if (this.getGeneralGroup(id)) return this.formatGeneralGroupReward(id, effect)

    return (this.originData?.Card || []).find((card) => card.id == id)?.name
  }

  formatQualityReward(id) {
    const [type, quality] = String(id).split(',')
    return REWARD_QUALITY_NAMES[quality] + CHOICE_REWARD_TYPE_NAMES[type]
  }

  formatGeneralGroupReward(groupId) {
    return this.getGeneralGroup(groupId)
      .map((general) => general.generalname)
      .join('\n')
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
