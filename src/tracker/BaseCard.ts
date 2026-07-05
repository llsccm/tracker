import { CardConfig } from '@/config'

/**
 * 重构版卡牌基类
 * 存储卡牌的 ID、展示名称、花色、点数、类型等静态元数据
 * 引入 CardConfig 单例进行 cardInfo 初始加载，而不是在构造中通过参数传递
 */
export class BaseCard {
  declare id: number
  declare name: string
  declare color: number
  declare number: number
  declare type: number
  declare ncn: string

  /**
   * @param id - 卡牌 ID
   */
  constructor(id: number) {
    this.setCardInfo(id)
  }

  /**
   * 设置卡牌元数据，自动从 CardConfig 单例中拉取
   */
  setCardInfo(id: number): this {
    this.id = id
    const cardInfo = CardConfig.GetInstance().getCard(id)
    this.name = cardInfo?.name ?? ''
    this.color = cardInfo?.color ?? 0
    this.number = cardInfo?.number ?? 0
    this.type = cardInfo?.type ?? 0
    this.ncn = cardInfo?.ncn ?? this.name
    return this
  }
}
