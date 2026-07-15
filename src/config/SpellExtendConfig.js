import ConfigBase from './ConfigBase'

export class SpellExtendConfig extends ConfigBase {
  PeiXiuBonus = new Map()
  PeiXiuCellDic = new Map()
  PeiXiuPresetRoutes = new Map([
    [1, [[4, 2, 3, 2, 3]]],
    [
      2,
      [
        [3, 2, 1, 2],
        [2, 1, 3, 2, 1],
        [4, 1, 2, 3, 2]
      ]
    ],
    [
      3,
      [
        [3, 1, 2, 4, 3, 2],
        [3, 3, 2, 1, 4, 2]
      ]
    ],
    [
      4,
      [
        [1, 3, 2, 4, 1],
        [3, 2, 4, 1, 1]
      ]
    ],
    [5, [[3, 1, 2, 4, 3]]],
    [6, [[1, 3, 2, 4, 2]]],
    [
      7,
      [
        [4, 3, 1, 1, 3, 2],
        [3, 2, 4, 3, 1, 1],
        [1, 3, 2, 4, 3, 1]
      ]
    ],
    [
      8,
      [
        [1, 4, 3, 2, 1],
        [2, 1, 4, 1, 3]
      ]
    ],
    [
      9,
      [
        [1, 3, 4, 1, 4, 1],
        [3, 4, 2, 1, 4, 1],
        [4, 1, 3, 2, 1, 4, 3, 4]
      ]
    ],
    [
      10,
      [
        [1, 4, 3, 4, 1, 2],
        [4, 1, 2, 1, 4, 3]
      ]
    ],
    [11, [[1, 2, 3, 2, 3]]],
    [12, [[3, 2, 3, 1, 4, 2]]],
    [13, [[3, 2, 3, 2, 4, 3, 4]]],
    [14, [[2, 1, 4, 3]]],
    [
      15,
      [
        [2, 1, 2, 1, 3, 1, 4],
        [2, 1, 2, 1, 1, 4, 2, 3]
      ]
    ],
    [16, [[4, 3, 2, 4, 1]]]
  ])

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
