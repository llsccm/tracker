import { CardConfig } from './CardConfig'
import { SkillsConfig } from './SkillsConfig'
import { CharacterConfig } from './CharacterConfig'
import { RoguelikeConfig } from './RoguelikeConfig'
import { SpellExtendConfig } from './SpellExtendConfig'

export class ConfigManager {
  configUrl = 'https://web.sanguosha.com/220/h5_2/res/config/Config_w.sgs'
  fileNames = ['sys_playcard', 'cha_spell', 'character', 'hd_roguelike', 'cha_spellextend']

  static GetInstance() {
    if (null == this.instance) {
      this.instance = new ConfigManager()
    }
    return this.instance
  }

  constructor() {
    this.preloadConfigerList = [
      CardConfig.GetInstance(),
      SkillsConfig.GetInstance(),
      CharacterConfig.GetInstance(),
      RoguelikeConfig.GetInstance(),
      SpellExtendConfig.GetInstance()
    ]
  }

  async loadAndParseConfigs() {
    const response = await fetch(this.configUrl)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

    const zipData = await response.arrayBuffer()
    const zip = await JSZip.loadAsync(zipData)

    const promises = this.preloadConfigerList.map(async (configer) => {
      if (!configer) return

      const data = await this.loadConfigFile(zip, configer.FileName)

      configer.parse(data)
    })

    await Promise.all(promises)
    console.info('[ConfigManager] Config_w 解析完成')
    if (import.meta.env.DEV) console.info(this)
  }

  async loadConfigFile(zip, fileName) {
    const file = zip.file(fileName + '.sgs')
    if (!file) {
      throw new Error(`File not found in zip: ${fileName}.sgs`)
    }

    const arrayBuffer = await file.async('arraybuffer')
    const decryptedData = CtrUtil.Ctr.Ofb_Dec(arrayBuffer)

    const uint8Array =
      decryptedData instanceof Uint8Array ? decryptedData : new Uint8Array(decryptedData)

    const gunzip = new Zlib.Gunzip(uint8Array)
    const decompressedData = gunzip.decompress()
    const fileData = new TextDecoder().decode(decompressedData)

    return JSON.parse(fileData)
  }
}
