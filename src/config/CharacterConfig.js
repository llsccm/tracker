import ConfigBase from './ConfigBase'

export class CharacterConfig extends ConfigBase {
  generalDict = {}

  constructor() {
    super('Character_json')
    this.FileName = 'character'
  }

  static GetInstance() {
    if (this.instance == null) {
      this.instance = new CharacterConfig()
    }

    return this.instance
  }

  parse(data) {
    if (!data) return
    this.initGeneralDict(data.GameCharacters?.character)
  }

  initGeneralDict(characters) {
    if (!characters?.length) return

    for (const { a, ai, b } of characters) {
      this.generalDict[a] = (ai || '') + b?.replaceAll('&', '')
    }
  }

  getGeneral(id) {
    return this.generalDict[id]
  }

  getGeneralName(id) {
    return this.getGeneral(id) || ''
  }
}
