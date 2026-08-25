import { Game } from '@/tracker/Game'
import { addTooltip } from '@/utils/notification'

// 每回合都可以发动
const ROUND_ZHAN_FA_IDS = new Set([
  2100, 2101, 2108, 2109, 2110, 2312, 2313, 2317, 2319, 2320, 2321, 2322
])
// 手到擒来 多多益善 自己的回合结束才清空
const SELF_TURN_ZHAN_FA_IDS = new Set([2079, 2080, 2081, 2082, 2083, 2084])

/**
 * 方法重定义/热替换工具
 * 将对象上的原有方法备份为 __prop，并使用新描述符定义该属性
 *
 * @param {Object} obj 目标对象
 * @param {string} prop 属性/方法名
 * @param {PropertyDescriptor} value 新的方法描述符配置
 * @returns {boolean} 是否重定义成功
 */
export function redefine(obj, prop, value) {
  if (typeof obj?.[prop] != 'function') return false
  if (Object.prototype.hasOwnProperty.call(obj, `__${prop}`)) return false
  Object.defineProperty(obj, `__${prop}`, Object.getOwnPropertyDescriptor(obj, prop))
  Object.defineProperty(obj, prop, { ...value, configurable: true })
  return true
}

/**
 * 获取当前页面的 window 对象（兼容 GM/Tampermonkey 脚本环境下的 unsafeWindow）
 *
 * @returns {Window & typeof globalThis}
 */
function getPageWindow() {
  if (typeof unsafeWindow == 'object') return unsafeWindow
  return window
}

/**
 * 辅助工具函数：根据事件名称在监听者列表中检索对应的 caller 对象
 *
 * @param {any} emitter 事件派发器
 * @param {string} eventName 事件名称
 * @param {string} [propKey] 可选的特征属性过滤，确认获取到的是正确的类/实例
 * @returns {any} 返回对应的 caller 实例
 */
function getCallerFromEvent(emitter, eventName, propKey = null) {
  const handlers = emitter?._events?.[eventName]
  if (!handlers) return undefined
  const list = Array.isArray(handlers) ? handlers : [handlers]
  return list
    .map((e) => e?.caller)
    .filter(Boolean)
    .find(
      (caller) =>
        !propKey ||
        Object.prototype.hasOwnProperty.call(caller, propKey) ||
        (caller.constructor && Object.prototype.hasOwnProperty.call(caller.constructor, propKey)) ||
        propKey in caller
    )
}

/**
 * 在 Laya Stage 节点中查找匹配的子节点
 *
 * @param {Object} stage 节点树的根节点
 * @param {string} key 匹配键值（可以是 '*'，或者是以 'Layer', 'View', 'Window' 结尾的名称，或者直接是节点名、场景名、类名）
 * @returns {any[] | any} 返回找到的节点数组、单个节点或空数组
 */
function findInStage(stage, key) {
  if (!stage) return []
  if (key in stage) return stage[key]

  let result = stage?._children?.filter(Boolean) || []

  if (key === '*' && stage?.viewStack?._childUIList?.length) {
    result = stage.viewStack._childUIList
  } else if (key?.endsWith?.('Layer')) {
    const order = [
      'BottomLayer',
      'BackgroundLayer',
      'SceneLayer',
      'AnimationLayer',
      'WindowLayer',
      'TopUILayer',
      'PromptLayer'
    ].indexOf(key)
    result = result.filter((layer) => layer.layerOrder == order)
  } else if (
    (key?.endsWith?.('View') || key?.endsWith?.('Window')) &&
    stage?.viewStack?._childList?.includes(key)
  ) {
    const indexes = stage.viewStack._childList
      .map((value, index) => (value == key ? index : -1))
      .filter((value) => value > -1)
    result = stage.viewStack._childUIList?.filter(
      (value, index) => value && indexes.includes(index)
    )
  } else if (key) {
    result = result.filter(
      (item) => item.name == key || item.sceneName == key || item.constructor?.name == key
    )
  }

  if (!result?.length) return []
  return Array.isArray(result) && result.length == 1 ? result[0] : result
}

/**
 * 内置的类解析器注册表
 * 当 class(name) 找不到已缓存的类且未传入 value 时，
 * 会查找此注册表中是否有对应 name 的解析函数来自动获取
 *
 * @type {Object<string, (runtime: GameRuntime) => any>}
 */
const classResolvers = {
  GameContext(_runtime) {
    const page = getPageWindow()
    const ctx = page?.GameContext || window.Laya?.Browser?.window?.GameContext || window.GameContext
    if (ctx && typeof ctx.GetModeType == 'function' && typeof ctx.GetGroupID == 'function') {
      return ctx
    }
  },
  GetGoodsByID(runtime) {
    return runtime.get('SgxFPreviewWindow', null, 0)?.getGoodConfig
  },
  SgsText(runtime) {
    return runtime.scene?.topMenu?.timeLabel?.constructor
  },
  SgsSpriteFilterBtn(runtime) {
    return runtime.scene?.topMenu?.backBtn?.constructor
  },
  GameEventDispatcher(runtime) {
    return runtime.get('PopUpWindow', null, 0)?.ged
  },
  WindowManager(runtime) {
    const ged = runtime.class('GameEventDispatcher')
    if (!ged) return undefined
    return getCallerFromEvent(ged, 'HIDE_WINDOW', 'WindowInstanceDict')
  },
  ServerProxy(runtime) {
    return runtime.class('WindowManager')?.proxy
  },
  SceneManager(runtime) {
    const ged = runtime.class('GameEventDispatcher')
    if (!ged) return undefined
    return getCallerFromEvent(ged, 'SWITCH_SCENE', 'CurrentScene')
  },
  RogueLikePveManager(runtime) {
    const proxy = runtime.class('ServerProxy')
    if (!proxy) return undefined
    return getCallerFromEvent(proxy, 'decodeRogueLikeDataSync')
  }
}

/**
 * 游戏运行时适配层，用于安全获取 Laya 引擎以及三国杀游戏内部的对象、类和场景信息
 */
export class GameRuntime {
  /**
   * 单例/实例缓存
   * @type {Object<string, any>}
   */
  instance = {}

  /**
   * 类/构造函数缓存
   * @type {Object<string, any>}
   */
  classes = {}

  /**
   * 斗地主等环境动态加载的外部运行时代码段 (动态属性，由外部写入)
   * @type {string|null}
   */
  __RUNTIME__ = null

  /**
   * 标记标志位
   * @type {any}
   */
  flag = null

  /**
   * 限制大小/数目限制
   * @type {number}
   */
  limit = 300

  /**
   * 顺序序列，用于排序等状态记录
   * @type {any[]}
   */
  order = []

  /**
   * 卡牌等标记方法的占位函数，由运行时或外部代码动态注入/重写
   * @type {Function}
   */
  mark = () => null

  /**
   * 调试追踪日志方法的占位函数
   * @type {Function}
   */
  trace = () => null

  /**
   * 严教等技能辅助的占位函数
   * @type {Function}
   */
  yanJiao = () => null

  /**
   * 是否已拦截势力口号发送
   * @type {boolean}
   */
  _powerSloganBlocked = false

  /**
   * 重置运行时状态标志和排序数组
   */
  reset() {
    this.flag = null
    this.order = []
  }

  /**
   * 初始化运行时
   * @returns {boolean}
   */
  init() {
    return true
  }

  /**
   * 获取或注册一个类
   * 如果传入 value 则注册该类；如果 value 是函数则注册其返回值。
   * 若无 value，则根据预设规则（如 GameContext 等）在页面 window 或 Laya 下自动寻找并注册。
   *
   * @param {string} name 类的唯一命名（如 'GameContext', 'SgsText' 等）
   * @param {boolean} [anew=false] 是否强制重新解析/注册
   * @param {any} [value] 注册的类定义或生成类的函数
   * @returns {any} 返回注册成功的类（构造函数）
   */
  class(name, anew = false, value = undefined) {
    if (!anew && this.classes[name]) return this.classes[name]

    const resolver = Object.prototype.hasOwnProperty.call(classResolvers, name)
      ? classResolvers[name]
      : undefined
    const resolved = typeof value == 'function' ? value() : value || resolver?.(this)
    if (resolved) this.classes[name] = resolved

    return this.classes[name]
  }

  /**
   * 获取（并可能实例化）指定名称的 Laya 单例或实例
   *
   * @param {string} name 类名或实例名
   * @param {any} [args] 构造函数参数。若不为 null 且实例有 Init 方法，将自动调用 Init()
   * @param {boolean|number} [dt=false] 生命周期删除模式。若不为 false，将延迟或立即执行 del(name, dt)
   * @param {Function} [callback] 实例获取成功后的回调函数
   * @returns {any} 实例化的对象或已缓存的实例
   */
  get(name, args, dt = false, callback) {
    if (name in this.classes) return this.class(name) ? new this.classes[name](args) : undefined
    if (!window.Laya?.ClassUtils?.getInstance) return undefined

    if (!this.instance[name]) {
      this.del(name)
      const instance = window.Laya.ClassUtils.getInstance(name, args)

      if (
        instance?.protoName != 'Protocol' &&
        typeof instance?.Init == 'function' &&
        args !== null
      ) {
        try {
          instance.Init()
        } catch (error) {
          console.error(`Laya instance ${name} Init() error!\n` + error.stack)
        }
      }

      this.instance[name] = instance
    }

    if (this.instance[name]?.timeoutId) clearTimeout(this.instance[name].timeoutId)
    if (typeof callback === 'function') callback(this.instance[name])
    if (dt !== false) this.del(name, dt)

    return this.instance[name]
  }

  /**
   * 删除/清理已缓存的实例，支持延迟销毁
   *
   * @param {string} name 实例名称
   * @param {boolean|number} [time=true] 销毁策略。true: 立即销毁; false/null: 不销毁; 数字: 延迟该毫秒数销毁
   */
  del(name, time = true) {
    const item = this.instance[name]
    if (!item || time === false || time === null) return

    if (item.timeoutId) {
      clearTimeout(item.timeoutId)
      delete item.timeoutId
    }

    const delNow = () => {
      if (!this.instance[name]) return

      try {
        if (!this.instance[name].parent) {
          if (typeof this.instance[name].Close == 'function') this.instance[name].Close()
          else this.instance[name].destroy?.()
        }
      } catch (error) {
        console.error('Laya instance ' + name + ' delete error!' + error)
      }

      delete this.instance[name]
    }

    if (time === true) delNow()
    else item.timeoutId = setTimeout(delNow, time)
  }

  /**
   * 在 Laya 舞台（stage）上链式过滤查找特定节点
   *
   * @param  {...any} keys 查找链参数。若第一个参数是普通对象，则以该对象为起点，否则从 window.Laya.stage 开始。后续参数依次作为查找 key。
   * @returns {any[]|any|null} 匹配到的节点，若未找到返回 null
   */
  find(...keys) {
    const isPlainObject = (obj) => Object.prototype.toString.call(obj) === '[object Object]'
    const start = isPlainObject(keys[0]) ? keys.shift() : window.Laya?.stage

    const result = keys.reduce((acc, key) => {
      if (!(acc instanceof Object)) return []

      if (Array.isArray(acc)) {
        if (!acc.length) return []

        if (Array.isArray(key)) {
          return acc.flatMap((item) => key.flatMap((itemKey) => findInStage(item, itemKey)))
        }

        return acc.flatMap((item) => findInStage(item, key))
      }

      if (Array.isArray(key)) return key.flatMap((itemKey) => findInStage(acc, itemKey))

      return findInStage(acc, key)
    }, start)

    return result?.length == 0 ? null : result
  }

  /**
   * 获取全局事件派发器 GameEventDispatcher
   * @returns {any}
   */
  get ged() {
    return this.class('GameEventDispatcher')
  }

  /**
   * 获取当前场景对象
   * @returns {any}
   */
  get scene() {
    return this.class('SceneManager')?.CurrentScene || this.find('SceneLayer', null)
  }

  /**
   * 获取当前游戏局内场景对象（如果是游戏场景）
   * @returns {any|null}
   */
  get gamescene() {
    return this.class('SceneManager')?.IsGameScene ? this.scene : null
  }

  /**
   * 聊天输入控制与消息发送
   *
   * @param {string} [chatmsg=''] 待发送或输入的聊天消息
   * @param {boolean|string|number} [channel=false] 聊天频道。
   *   - false: 仅设置聊天框文本输入，不发送。
   *   - string: 以 channel 名作为前缀，并将 chatmsg 进行 Base64 编码发送。
   *   - true: 根据场景自动判断频道代码（2 或 7）。
   *   - number: 显式指定发送的频道编号（2: 局内聊天, 13: 阵营聊天, 其他: 通用聊天）。
   * @returns {any}
   */
  chat(chatmsg = '', channel = false) {
    if (!channel) {
      const UI =
        this.gamescene?.chatViewUI ||
        this.scene?.chatViewUI ||
        this.find(this.gamescene || this.scene, null, 'chatViewUI')
      return UI?.chatInput && (UI.chatInput.text = chatmsg)
    }

    if (typeof channel === 'string') {
      chatmsg = channel + ':' + btoa(chatmsg)
      channel = true
    }

    if (channel === true) channel = this.gamescene?.chatViewUI?.chatInput ? 2 : 7

    if (typeof channel !== 'number') return
    const manager = this.class('ChatManager')

    if (!manager) return

    if (channel == 2 && typeof manager.SendChatMsg == 'function')
      return manager.SendChatMsg(chatmsg)
    if (channel == 13 && typeof manager.SendCampChatMsg == 'function')
      return manager.SendCampChatMsg(chatmsg)
    if (typeof manager.SendBaseChatMsg == 'function')
      return manager.SendBaseChatMsg(chatmsg, channel, '', 0)
  }

  /**
   * 座位 UI 重新绘制
   * @returns {any}
   */
  seatUIs() {
    this.init(true)
    if (!this._gamescene) return null

    const verbose = this.limit == 290
    const seatUIs = this.gamescene.seatContainer?.seatUIs
    const seats = seatUIs?.map((ui) => ui.seat)?.filter((s) => !s.isHide)

    // this.patchRightViewFigureList()
    // this.updateGuoZhanCountrySummary(this.gamescene?.rightView)

    if (!Game.isGuoZhan && !seats?.filter((s) => s.fixedViewId)?.length) return []

    let SeatUIs = seats.map((seat, i, seats) => ({
      seat,
      seatID: seat.index,
      order: seat.fixedViewId - 1,
      figure: !Game.isGuoZhan
        ? seat.figure == seats[0].figure
        : seat.Country == seats[0].Country || -!!seat.Country,
      ai: seat?.playerInfo?.ClientId < 4e9 ? 0 : seat.playerInfo?.IsNormalRobot ? 2 : 1
    }))

    if (verbose === true && SeatUIs.some(({ ai }) => ai) && !Game.isShanHeTu) {
      addTooltip('对战AI小杀！')
    }

    SeatUIs = SeatUIs.map((ui) => ({ ...ui, index: this.order.indexOf(ui.seatID) })).sort(
      (a, b) => a.figure - b.figure || b.ai - a.ai || a.index - b.index || a.order - b.order
    )

    this.order = SeatUIs.map((e) => e.seatID)
    // console.warn('优先级：', SeatUIs.map(({ seatID, order, figure, ai }) => (['玩家-', '玫瑰金-', '小杀-'][ai]) + (room.name(seatID) || seatID) + '-' + order + (figure ? '-队友' : '')).join('>'));
    const self = this.gamescene.SelfSeatUi
    const cardContainer = self.cardContainer
    const cardUis = cardContainer?.cardUis
    const btnUIs = self.buttonBar?.btns
    const skillItems = self.skillItems
    const spellSelector = self.spellSelector
    if (!verbose) return true
    if (!cardUis || !btnUIs || !skillItems || !spellSelector) return false
    this.limit--

    this.mark = (ids, label, _, uis = cardUis) =>
      ids != false &&
      setTimeout(() => {
        if (Array.isArray(ids))
          uis = ids.map((id) => cardContainer.getCardUiBy(id, false, uis)).filter(Boolean)
        // 炁标记源码已经处理好 不需额外处理重复添加label的问题
        uis.forEach((ui) => ui?.AddCardTag?.(label))
      })
  }

  ShowWindow(name) {
    const GameEventDispatcher = this.ged
    if (!GameEventDispatcher) return
    GameEventDispatcher.i?.(name)
  }

  // 不能使用 WindowManager.GetWindow 此方法会找不到窗口会创建一个 造成污染
  GetWindow(name) {
    const manager = this.class('WindowManager')
    if (!manager) return null

    const dict = manager?.WindowInstanceDict
    const cachedWindow = dict?.get(name)
    if (cachedWindow) return cachedWindow

    const foundWindow = this.find('WindowLayer', name)
    if (Array.isArray(foundWindow)) return foundWindow.find(Boolean) ?? null
    return foundWindow ?? null
  }

  showName() {
    this.gamescene?.seatContainer?.seatUIs?.forEach(({ seat, otherTopManager }) => {
      if (seat?.playerInfo?.ClientId >= 4e9) return
      otherTopManager?.createPlayerNameBg()
      otherTopManager?.createPlayerName()
      otherTopManager?.UpdatePlayerName(seat.playerInfo)
      otherTopManager?.SetPlayNameVisible(true)
      otherTopManager?.layout()
    })
  }

  /**
   * 阻止座位 UI 自动发送势力口号（幂等）
   * 挂在座位原型上，改一次后所有座位共用，无需逐个座位重复修改
   * @returns {boolean} 是否已成功挂上拦截
   */
  blockPowerSlogan() {
    if (this._powerSloganBlocked) return true

    const seatList = this.scene?.seatListView?.seatList
    if (!Array.isArray(seatList) || !seatList.length) return false

    const proto = seatList.find(
      (seat) => seat?.__proto__ && typeof seat.__proto__.showPowerSlogan == 'function'
    )?.__proto__
    if (!proto) return false

    redefine(proto, 'showPowerSlogan', {
      value() {
        return
      }
    })

    if (!proto.__showPowerSlogan) return false

    this._powerSloganBlocked = true
    return true
  }

  /** 存战斗中所有战法实例 */
  zhanfaMap = new Map()

  ZHANFA = new Set([
    13027, 13028, 13029, 13039, 13040, 13041, 13087, 13088, 13089, 13184, 13185, 13293, 13294,
    13033, 13034, 13035, 13070, 13071, 13072, 13073, 13074, 13075, 13091, 13098
  ])

  shaCounter() {
    // 万一以后有角色在其他模式获得战法...
    if (!Game.isShanHeTu && !Game.isRoguelike1v1) return
    const value = Number(Game.getSpellState('三板斧')) % 3
    const targetIds = [13033, 13034, 13035]

    for (const id of targetIds) {
      const zhanfa = this.zhanfaMap.get(id)
      if (zhanfa) {
        zhanfa.Value = value
      }
    }
  }

  useCounter() {
    if (!Game.isShanHeTu && !Game.isRoguelike1v1) return
    const value = Game.getSpellState('手到擒来')
    const targetIds = [13070, 13071, 13072]

    for (const id of targetIds) {
      const zhanfa = this.zhanfaMap.get(id)
      if (zhanfa) {
        zhanfa.Value = value
      }
    }
  }

  drawCounter() {
    if (!Game.isShanHeTu && !Game.isRoguelike1v1) return
    const count = Number(Game.getSpellState('神龙摆尾'))
    const times = Game.getSpellState('多多益善')

    const shenlong1 = this.zhanfaMap.get(13091)
    if (shenlong1) shenlong1.Value = count % 9

    const shenlong2 = this.zhanfaMap.get(13098)
    if (shenlong2) shenlong2.Value = count % 6

    const targetIds = [13073, 13074, 13075]

    for (const id of targetIds) {
      const zhanfa = this.zhanfaMap.get(id)
      if (zhanfa) {
        zhanfa.Value = times
      }
    }
  }

  zhanfaCounter(SkillId) {
    const zhanfa = this.zhanfaMap.get(SkillId)

    if (!zhanfa) return
    if (zhanfa.n === undefined) zhanfa.n = 0
    zhanfa.Value = ++zhanfa.n
  }

  zhanfaRegister() {
    this.gamescene?.SelfSeatUi?.zhanFaItems?.forEach((ui) => {
      if (this.ZHANFA.has(ui.SkillId)) this.zhanfaMap.set(ui.SkillId, ui)
    })
  }

  zhanfaReset() {
    for (const [_, ui] of this.zhanfaMap) {
      if (ui?.n !== undefined) ui.Value = ui.n = 0
    }
  }

  resetRoundZhanFa(previousSeatID) {
    for (const [_, ui] of this.zhanfaMap) {
      // 每回合都可以发动
      if (ui?.n !== undefined && ROUND_ZHAN_FA_IDS.has(ui.PlotID)) {
        ui.Value = ui.n = 0
      }

      // 自己的回合结束才清空 手到擒来 多多益善
      // 主视角下一个角色回合开始 代表主视角的回合已经结束
      if (previousSeatID === Game.myID && SELF_TURN_ZHAN_FA_IDS.has(ui.PlotID)) {
        ui.Value = 0
      }
    }
  }
}

/**
 * @type {GameRuntime}
 */
export const laya = new GameRuntime()
