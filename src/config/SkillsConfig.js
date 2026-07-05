import { shortName } from '@/utils'
import ConfigBase from './ConfigBase'

export class SkillsConfig extends ConfigBase {
  spellDict = new Map()
  markSpell = { 290: '推锋', 766: '匡弼', 432: '醇醪' }

  constructor() {
    super('ChaSpell_json')
    this.FileName = 'cha_spell'
  }

  static GetInstance() {
    if (this.instance == null) {
      this.instance = new SkillsConfig()
    }

    return this.instance
  }

  parse(data) {
    if (!data) return
    this.initAbbreviation(data.abbreviation?.field || data.abbreviation)
    this.initSpellDict(data.GameSpells?.spell)
  }

  initSpellDict(spells) {
    if (!spells?.length) return

    for (const spell of spells) {
      const spellInfo = {}

      for (const [shortKey, value] of Object.entries(spell)) {
        const longKey = this.shortToLongObj[shortKey] || shortKey
        spellInfo[longKey] = value
      }

      const id = Number(spellInfo.id)
      this.spellDict.set(id, spellInfo)
      this.markSpell[id] = shortName[spellInfo.name] || spellInfo.name
    }
  }

  getSpell(id) {
    return this.spellDict.get(Number(id))
  }

  getSpellName(id) {
    return this.getSpell(id)?.name || '无收录技能'
  }
}
