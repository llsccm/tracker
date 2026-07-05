import { n2C, n2N, shortName } from '@/utils'
import ConfigBase from './ConfigBase'

/** 子类型编号 → 显示名称映射（火杀、雷杀、冰杀、闪闪） */
export const SUB_TYPE_NAMES = {
  6: '火杀',
  7: '雷杀',
  11: '冰杀',
  12: '闪闪'
}

// { "name": "", "type": 0, "color": 0, "number": 0, 'ncn': '?', 'cn': '0', 'c': '', 'n': 0 }

export class CardConfig extends ConfigBase {
  cards = new Map()
  cardsByClassName = new Map()
  cardIDsOrder = []

  constructor() {
    super('Cards_json')
    this.FileName = 'sys_playcard'
  }

  static GetInstance() {
    if (this.instance == null) {
      this.instance = new CardConfig()
    }

    return this.instance
  }

  parse(data) {
    if (!data) return
    this.initAbbreviation(data.abbreviation?.field || data.abbreviation)
    this.gamePlayCards = data.GamePlayCards
    this.initCardsByClassName()

    // 我完全不知道这是什么
    this.cardIDsOrder = data.GamePlayCards.card
      .sort(
        (a, b) =>
          a.c - b.c || a.d - b.d || a.h - b.h || a.m - b.m || a.g - b.g || a.f - b.f || a.a - b.a
      )
      .map(({ a }) => a)
  }

  initCardsByClassName() {
    if (!this.gamePlayCards) return

    this.addCards(this.gamePlayCards.card, true)
    this.addCards(this.gamePlayCards.card_H5)
  }

  addCards(cards, needDecode = false) {
    if (!cards || !cards.length) return

    for (const cardData of cards) {
      if (!cardData) continue

      const cardInfo = needDecode ? {} : cardData

      if (needDecode) {
        for (const [shortKey, value] of Object.entries(cardData)) {
          const longKey = this.shortToLongObj[shortKey] || shortKey
          cardInfo[longKey] = value
        }
      }

      const { name, color, number, subType } = cardInfo
      const suit = n2C(color)
      const num = n2N(number)

      cardInfo.name = SUB_TYPE_NAMES[subType] || shortName[name] || name
      cardInfo.ncn = name + suit + num
      cardInfo.cn = suit + num
      cardInfo.c = suit
      cardInfo.n = num

      this.cards.set(cardInfo.id, cardInfo)

      if (cardInfo.res && !this.cardsByClassName.has(cardInfo.res)) {
        this.cardsByClassName.set(cardInfo.res, cardInfo)
      }
    }

    this.cards.set(0, { id: 0, name: '', color: 0, number: 0, ncn: '?', cn: '0', c: '', n: 0 })
  }

  getCard(id) {
    return this.cards.get(id)
  }

  getCardName(id) {
    return this.getCard(id)?.name || ''
  }

  getCardNumber(id) {
    return this.getCard(id)?.number || 0
  }

  getCardColor(id) {
    return this.getCard(id)?.color || 0
  }

  getCardncn(id) {
    return this.getCard(id)?.ncn || '?'
  }
}
