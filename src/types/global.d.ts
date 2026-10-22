export {}

declare global {
  interface Window {
    Laya?: typeof Laya
    padding?: number
  }

  const unsafeWindow: Window | undefined

  /**
   * 宿主页面提供的 LayaAir 2.13.3，覆盖项目使用的 API 与常用 UI 组件。
   * https://github.com/layabox/LayaAir/tree/LayaAir_2.13.3/src/layaAir
   * https://layaair2.ldc2.layabox.com/api2/English/index.html
   * 文档中的 laya.ui.* 对应浏览器全局 Laya.*，例如 new Laya.VBox()。
   * 游戏自定义类与字段由 runtime/gameAdapter 解析，不属于引擎类型。
   */
  namespace Laya {
    // 引擎初始化前尚未创建这两个实例。
    let stage: Stage | undefined
    let timer: Timer | undefined

    type Callback = (...args: any[]) => any

    class Handler {
      constructor(
        caller?: object | null,
        method?: Callback | null,
        args?: any[] | null,
        once?: boolean
      )

      caller: object | null
      method: Callback | null
      args: any[] | null
      once: boolean

      static create(
        caller: any,
        method: Callback | null,
        args?: any[] | null,
        once?: boolean
      ): Handler
      setTo(caller: any, method: Callback | null, args: any[] | null, once?: boolean): Handler
      run(): any
      runWith(data: any): any
      clear(): Handler
      recover(): void
    }

    class Event {
      static CLICK: string
      static DOUBLE_CLICK: string
      static MOUSE_DOWN: string
      static MOUSE_UP: string
      static MOUSE_MOVE: string
      static MOUSE_OVER: string
      static MOUSE_OUT: string
      static MOUSE_WHEEL: string
      static CHANGE: string
      static CHANGED: string
      static RESIZE: string
      static ADDED: string
      static REMOVED: string
      static DISPLAY: string
      static UNDISPLAY: string
      static COMPLETE: string
      static LOADED: string
      static INPUT: string
      static ENTER: string
      static SELECT: string
      static BLUR: string
      static FOCUS: string
      static KEY_DOWN: string
      static KEY_UP: string

      type: string
      nativeEvent: any
      target: Sprite
      currentTarget: Sprite
      touchId: number
      keyCode: number
      delta: number
      readonly stageX: number
      readonly stageY: number
      readonly altKey: boolean
      readonly ctrlKey: boolean
      readonly shiftKey: boolean

      setTo(type: string, currentTarget: Sprite, target: Sprite): Event
      stopPropagation(): void
    }

    class EventDispatcher {
      /** 引擎内部事件表；gameAdapter 用它查找宿主监听器的 caller。 */
      _events?: Record<string, Handler | (Handler | null)[]> | null

      hasListener(type: string): boolean
      event(type: string, data?: any): boolean
      on(type: string, caller: any, listener: Callback, args?: any[] | null): EventDispatcher
      once(type: string, caller: any, listener: Callback, args?: any[] | null): EventDispatcher
      off(type: string, caller: any, listener: Callback | null, onceOnly?: boolean): EventDispatcher
      offAll(type?: string | null): EventDispatcher
      offAllCaller(caller: any): EventDispatcher
    }

    class Node extends EventDispatcher {
      name: string
      destroyed: boolean
      readonly parent: Node | null
      readonly numChildren: number
      readonly displayedInStage: boolean

      /** 引擎内部子节点列表；gameAdapter 用它遍历宿主场景。 */
      _children: Node[] | null

      addChild(node: Node): Node
      addChildAt(node: Node, index: number): Node
      addChildren(...nodes: Node[]): void
      getChildAt(index: number): Node | null
      getChildByName(name: string): Node | null
      getChildIndex(node: Node): number
      setChildIndex(node: Node, index: number): Node
      removeChild(node: Node): Node | null
      removeChildAt(index: number): Node | null
      removeChildren(beginIndex?: number, endIndex?: number): Node
      removeSelf(): Node
      destroyChildren(): void
      destroy(destroyChild?: boolean): void
      callLater(method: Callback, args?: any[] | null): void
      runCallLater(method: Callback): void
    }

    interface DrawRectCmd {
      x: number
      y: number
      width: number
      height: number
      fillColor: any
      lineColor: any
      lineWidth: number
      readonly cmdID: string
    }

    class Graphics {
      clear(recoverCmds?: boolean): void

      drawRect(
        x: number,
        y: number,
        width: number,
        height: number,
        fillColor: any,
        lineColor?: any,
        lineWidth?: number
      ): DrawRectCmd
    }

    class Sprite extends Node {
      x: number
      y: number
      width: number
      height: number
      scaleX: number
      scaleY: number
      pivotX: number
      pivotY: number
      rotation: number
      alpha: number
      visible: boolean
      mouseEnabled: boolean
      zOrder: number
      graphics: Graphics
      cacheAs: string
      readonly stage: Stage
      readonly displayWidth: number
      readonly displayHeight: number

      pos(x: number, y: number, speedMode?: boolean): Sprite
      size(width: number, height: number): Sprite
      scale(scaleX: number, scaleY: number, speedMode?: boolean): Sprite
      pivot(x: number, y: number): Sprite
    }

    class Text extends Sprite {
      static VISIBLE: string
      static SCROLL: string
      static HIDDEN: string

      text: string
      font: string
      fontSize: number
      color: string
      bold: boolean
      italic: boolean
      align: string
      valign: string
      wordWrap: boolean
      overflow: string
      padding: number[]
      bgColor: string
      borderColor: string
      leading: number
      stroke: number
      strokeColor: string
      readonly textWidth: number
      readonly textHeight: number

      typeset(): void
      changeText(text: string): void
    }

    // UI 基类与布局容器（laya/ui）。
    class UIComponent extends Sprite {
      constructor(createChildren?: boolean)

      top: number
      bottom: number
      left: number
      right: number
      centerX: number
      centerY: number
      anchorX: number
      anchorY: number
      dataSource: any
      tag: any
      toolTip: any
      gray: boolean
      disabled: boolean
    }

    class Box extends UIComponent {
      bgColor: string
    }

    class LayoutBox extends Box {
      space: number
      align: string

      refresh(): void
    }

    class VBox extends LayoutBox {
      static NONE: string
      static LEFT: string
      static CENTER: string
      static RIGHT: string

      isSortItem: boolean
    }

    class HBox extends LayoutBox {
      static NONE: string
      static TOP: string
      static MIDDLE: string
      static BOTTOM: string
    }

    class Label extends UIComponent {
      constructor(text?: string)

      text: string
      font: string
      fontSize: number
      color: string
      bold: boolean
      italic: boolean
      align: string
      valign: string
      leading: number
      wordWrap: boolean
      /** Label 使用逗号分隔字符串；Text.padding 使用数字数组。 */
      padding: string
      bgColor: string
      borderColor: string
      stroke: number
      strokeColor: string
      overflow: string
      underline: boolean
      underlineColor: string
      readonly textField: Text

      changeText(text: string): void
    }

    class Image extends UIComponent {
      constructor(skin?: string | null)

      skin: string
      sizeGrid: string
      group: string

      dispose(): void
    }

    class Button extends UIComponent {
      constructor(skin?: string | null, label?: string)

      skin: string
      sizeGrid: string
      stateNum: number
      toggle: boolean
      selected: boolean
      label: string
      labelColors: string
      strokeColors: string
      labelPadding: string
      labelSize: number
      labelStroke: number
      labelStrokeColor: string
      labelBold: boolean
      labelFont: string
      labelAlign: string
      iconOffset: string
      clickHandler: Handler | null
      readonly text: Text
    }

    class CheckBox extends Button {}

    class TextInput extends Label {
      skin: string
      sizeGrid: string
      multiline: boolean
      editable: boolean
      restrict: string
      prompt: string
      promptColor: string
      maxChars: number
      focus: boolean
      type: string

      select(): void
      setSelection(startIndex: number, endIndex: number): void
    }

    class TextArea extends TextInput {
      vScrollBarSkin: string
      hScrollBarSkin: string
      readonly vScrollBar: VScrollBar | null
      readonly hScrollBar: HScrollBar | null
      readonly maxScrollY: number
      readonly maxScrollX: number
      readonly scrollY: number
      readonly scrollX: number

      scrollTo(y: number): void
    }

    // 列表、面板及其滚动控件。
    class Slider extends UIComponent {
      constructor(skin?: string | null)

      skin: string
      sizeGrid: string
      min: number
      max: number
      value: number
      tick: number
      isVertical: boolean
      showLabel: boolean
      allowClickBack: boolean
      changeHandler: Handler | null
      readonly bar: Button

      setSlider(min: number, max: number, value: number): void
      changeValue(): void
    }

    class HSlider extends Slider {}
    class VSlider extends Slider {}

    class ScrollBar extends UIComponent {
      constructor(skin?: string | null)

      skin: string
      sizeGrid: string
      min: number
      max: number
      value: number
      tick: number
      scrollSize: number
      thumbPercent: number
      isVertical: boolean
      scaleBar: boolean
      autoHide: boolean
      hide: boolean
      showButtons: boolean
      touchScrollEnable: boolean
      mouseWheelEnable: boolean
      elasticDistance: number
      elasticBackTime: number
      rollRatio: number
      disableDrag: boolean
      target: Sprite | null
      changeHandler: Handler | null
      upButton: Button
      downButton: Button
      slider: Slider
      readonly lastOffset: number

      setScroll(min: number, max: number, value: number): void
      stopScroll(): void
    }

    class HScrollBar extends ScrollBar {}
    class VScrollBar extends ScrollBar {}

    class Panel extends Box {
      constructor()

      vScrollBarSkin: string
      hScrollBarSkin: string
      elasticEnabled: boolean
      readonly vScrollBar: ScrollBar | null
      readonly hScrollBar: ScrollBar | null
      readonly content: Sprite
      readonly contentWidth: number
      readonly contentHeight: number

      scrollTo(x?: number, y?: number): void
      refresh(): void
    }

    class List extends Box {
      itemRender: any
      array: any[]
      repeatX: number
      repeatY: number
      spaceX: number
      spaceY: number
      startIndex: number
      selectedIndex: number
      selectedItem: any
      selection: Box | null
      selectEnable: boolean
      page: number
      totalPage: number
      vScrollBarSkin: string
      hScrollBarSkin: string
      scrollBar: ScrollBar | null
      elasticEnabled: boolean
      cacheContent: boolean
      disableStopScroll: boolean
      selectHandler: Handler | null
      renderHandler: Handler | null
      mouseHandler: Handler | null
      readonly content: Box
      readonly cells: Box[]
      readonly length: number

      initItems(): void
      setContentSize(width: number, height: number): void
      updateArray(array: any[]): void
      refresh(): void
      getItem(index: number): any
      changeItem(index: number, source: any): void
      setItem(index: number, source: any): void
      addItem(source: any): void
      addItemAt(source: any, index: number): void
      deleteItem(index: number): void
      getCell(index: number): Box | null
      scrollTo(index: number): void
      tweenTo(index: number, time?: number, complete?: Handler | null): void
    }

    class Stage extends Sprite {
      /** 引擎内部渲染循环；BackgroundWorker 的后台保活依赖此入口。 */
      _loop(): boolean
    }

    class Timer {
      /** 引擎内部计时器更新；BackgroundWorker 的后台保活依赖此入口。 */
      _update(): void
    }

    class Browser {
      static readonly window: Window & typeof globalThis
    }

    class ClassUtils {
      static regClass(className: string, classDef: any): void
      static getClass(className: string): any

      /**
       * 根据注册名创建宿主类，返回值取决于宿主的动态注册表。
       * gameAdapter 仍传入第二个参数；原版 2.13.3 只读取 className，忽略额外参数。
       */
      static getInstance(className: string, legacyArgs?: unknown): any
    }
  }
}
