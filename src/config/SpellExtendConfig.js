import ConfigBase from './ConfigBase'

export class SpellExtendConfig extends ConfigBase {
  PeiXiuBonus = new Map()
  PeiXiuCellDic = new Map()

  constructor() {
    super('SpellExtend_json')
    this.FileName = 'cha_spellextend'
  }

  static GetInstance() {
    if (this.instance == null) {
      this.instance = new SpellExtendConfig()
    }

    return this.instance
  }

  parse(data) {
    if (!data) return
    this.originData = data
    this.PeiXiuBonus.clear()
    this.PeiXiuCellDic.clear()
    this.initPeiXiuBonus()
    this.initPeiXiuCellData()
  }

  initPeiXiuBonus() {
    const rewards = this.originData?.PXreward
    if (!rewards?.length) return

    for (const reward of rewards) {
      this.PeiXiuBonus.set(Number(reward.ID), reward)
    }
  }

  initPeiXiuCellData() {
    const cells = this.originData?.PXcell
    if (!cells?.length) return

    for (const cell of cells) {
      this.PeiXiuCellDic.set(Number(cell.cellID), cell)
    }
  }
}
