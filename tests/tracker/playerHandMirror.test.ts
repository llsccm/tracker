import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRenderedMainHandCardIDs,
  getRenderedMainHandCardIDs,
  renderPlayerHand,
  subscribeRenderedMainHandCardIDs
} from '@/tracker/view/PlayerHandView'
import type { Card } from '@/tracker/Card'
import type { Player } from '@/tracker/Player'

const DIRECT_RENDER_SELECTOR = ':scope > .shoupai, :scope > .markedCard'
const RENDER_KEY_ATTRIBUTE = 'data-tracker-render-key'

class TestElement {
  readonly tagName: string
  readonly attributes = new Map<string, string>()
  readonly children: TestElement[] = []
  parentElement: TestElement | null = null
  innerHTML = ''
  textContent = ''
  insertBeforeCalls = 0

  private classes = new Set<string>()

  readonly classList = {
    add: (...tokens: string[]) => tokens.forEach((token) => this.classes.add(token)),
    remove: (...tokens: string[]) => tokens.forEach((token) => this.classes.delete(token)),
    contains: (token: string) => this.classes.has(token),
    toggle: (token: string, force?: boolean) => {
      const shouldAdd = force ?? !this.classes.has(token)
      if (shouldAdd) this.classes.add(token)
      else this.classes.delete(token)
      return shouldAdd
    }
  }

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase()
  }

  get id(): string {
    return this.attributes.get('id') ?? ''
  }

  set id(value: string) {
    this.setAttribute('id', value)
  }

  get title(): string {
    return this.attributes.get('title') ?? ''
  }

  set title(value: string) {
    this.setAttribute('title', value)
  }

  get className(): string {
    return Array.from(this.classes).join(' ')
  }

  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean))
  }

  get firstElementChild(): TestElement | null {
    return this.children[0] ?? null
  }

  get nextElementSibling(): TestElement | null {
    if (!this.parentElement) return null
    const index = this.parentElement.children.indexOf(this)
    return this.parentElement.children[index + 1] ?? null
  }

  appendChild<T extends TestElement>(child: T): T {
    child.detach()
    child.parentElement = this
    this.children.push(child)
    return child
  }

  insertBefore<T extends TestElement>(child: T, reference: TestElement | null): T {
    this.insertBeforeCalls += 1
    if (child === reference) return child

    child.detach()
    const index = reference ? this.children.indexOf(reference) : this.children.length
    if (index < 0) throw new Error('reference node is not a child')

    child.parentElement = this
    this.children.splice(index, 0, child)
    return child
  }

  remove(): void {
    this.detach()
  }

  setAttribute(name: string, value: string): void {
    if (name === 'class') {
      this.className = value
      return
    }
    this.attributes.set(name, String(value))
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.className || null
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string): void {
    if (name === 'class') {
      this.classes.clear()
      return
    }
    this.attributes.delete(name)
  }

  querySelectorAll(selector: string): TestElement[] {
    if (selector === DIRECT_RENDER_SELECTOR) {
      return this.children.filter(
        (child) => child.classList.contains('shoupai') || child.classList.contains('markedCard')
      )
    }

    if (selector === '[id]') {
      return this.getDescendants().filter((child) => Boolean(child.id))
    }

    return []
  }

  cloneNode(deep = false): TestElement {
    const clone = new TestElement(this.tagName)
    clone.className = this.className
    this.attributes.forEach((value, name) => clone.attributes.set(name, value))
    clone.innerHTML = this.innerHTML
    clone.textContent = this.textContent

    if (deep) {
      this.children.forEach((child) => clone.appendChild(child.cloneNode(true)))
    }

    return clone
  }

  private detach(): void {
    if (!this.parentElement) return
    const index = this.parentElement.children.indexOf(this)
    if (index >= 0) this.parentElement.children.splice(index, 1)
    this.parentElement = null
  }

  private getDescendants(): TestElement[] {
    return this.children.flatMap((child) => [child, ...child.getDescendants()])
  }
}

interface RenderHarness {
  doc: Document
  body: TestElement
  overlay: TestElement
}

function createRenderHarness(): RenderHarness {
  const body = new TestElement('div')
  const overlay = new TestElement('div')
  const panel = {
    querySelector() {
      return body
    }
  }
  const panelRoot = {
    querySelector() {
      return panel
    }
  }

  const doc = {
    createElement(tagName: string) {
      return new TestElement(tagName)
    },
    getElementById(id: string) {
      return id === 'button' ? panelRoot : null
    },
    querySelector(selector: string) {
      return selector === '#seatUI #s1' ? overlay : null
    }
  } as unknown as Document

  return { doc, body, overlay }
}

function createCard(id: number, title = ''): Card {
  return {
    id,
    color: 3,
    number: 1,
    name: '杀',
    getLocationDescription: () => title
  } as unknown as Card
}

function createPlayer(seatID: number, mySeatID: number, cardIDs: number[]): Player {
  return createPlayerFromCards(
    seatID,
    mySeatID,
    cardIDs.map((id) => createCard(id))
  )
}

function createPlayerFromCards(
  seatID: number,
  mySeatID: number,
  knownHandCards: Card[],
  candidateHandCards: Card[] = [],
  markCards: Map<number, Card[]> = new Map()
): Player {
  return {
    seatID,
    fixedViewId: 1,
    room: { mySeatID },
    knownHandCards,
    candidateHandCards,
    markCards
  } as unknown as Player
}

function getNodeByKey(container: TestElement, key: string): TestElement {
  const node = container.children.find(
    (child) => child.getAttribute(RENDER_KEY_ATTRIBUTE) === key
  )
  if (!node) throw new Error(`missing rendered node: ${key}`)
  return node
}

function getRenderedKeys(container: TestElement): (string | null)[] {
  return container.children.map((child) => child.getAttribute(RENDER_KEY_ATTRIBUTE))
}

describe('主视角渲染手牌镜像', () => {
  beforeEach(() => {
    clearRenderedMainHandCardIDs()
  })

  it('仅在主视角手牌成功渲染后更新镜像', () => {
    const { doc } = createRenderHarness()

    renderPlayerHand(doc, createPlayer(2, 1, [21]))
    expect(getRenderedMainHandCardIDs()).toBeNull()

    renderPlayerHand(doc, createPlayer(1, 1, [11, 12]))
    expect(getRenderedMainHandCardIDs()).toEqual([11, 12])
  })

  it('返回防御性副本并区分空手牌与尚未渲染', () => {
    const { doc } = createRenderHarness()
    renderPlayerHand(doc, createPlayer(1, 1, [31]))

    const snapshot = getRenderedMainHandCardIDs()
    snapshot?.push(32)
    expect(getRenderedMainHandCardIDs()).toEqual([31])

    renderPlayerHand(doc, createPlayer(1, 1, []))
    expect(getRenderedMainHandCardIDs()).toEqual([])

    clearRenderedMainHandCardIDs()
    expect(getRenderedMainHandCardIDs()).toBeNull()
  })

  it('镜像内容变化时通知订阅者，相同内容不重复通知', () => {
    const { doc } = createRenderHarness()
    let updates = 0
    const unsubscribe = subscribeRenderedMainHandCardIDs(() => {
      updates += 1
    })

    renderPlayerHand(doc, createPlayer(1, 1, [41, 42]))
    renderPlayerHand(doc, createPlayer(1, 1, [41, 42]))
    expect(updates).toBe(1)

    renderPlayerHand(doc, createPlayer(1, 1, [41, 42, 43]))
    expect(updates).toBe(2)

    unsubscribe()
    renderPlayerHand(doc, createPlayer(1, 1, [41]))
    expect(updates).toBe(2)
  })

  it('相同内容重复渲染时复用主面板和座位镜像节点', () => {
    const { doc, body, overlay } = createRenderHarness()
    const player = createPlayer(1, 1, [1, 2])

    renderPlayerHand(doc, player)
    const mainNodes = body.children.slice()
    const overlayNodes = overlay.children.slice()
    const mainInsertions = body.insertBeforeCalls
    const overlayInsertions = overlay.insertBeforeCalls

    renderPlayerHand(doc, player)

    expect(body.children[0]).toBe(mainNodes[0])
    expect(body.children[1]).toBe(mainNodes[1])
    expect(overlay.children[0]).toBe(overlayNodes[0])
    expect(overlay.children[1]).toBe(overlayNodes[1])
    expect(body.insertBeforeCalls).toBe(mainInsertions)
    expect(overlay.insertBeforeCalls).toBe(overlayInsertions)
    expect(
      [...body.children, ...overlay.children].every(
        (node) => node.getAttribute('data-tracker-render-signature') === null
      )
    ).toBe(true)
  })

  it('新增、移除和重排手牌时保留未变化节点', () => {
    const { doc, body, overlay } = createRenderHarness()
    const first = createCard(1)
    const second = createCard(2)
    const third = createCard(3)
    const player = createPlayerFromCards(1, 1, [first, second])

    renderPlayerHand(doc, player)
    const mainFirst = getNodeByKey(body, 'hand:known:1')
    const mainSecond = getNodeByKey(body, 'hand:known:2')
    const overlayFirst = getNodeByKey(overlay, 'hand:known:1')
    const overlaySecond = getNodeByKey(overlay, 'hand:known:2')

    player.knownHandCards.push(third)
    renderPlayerHand(doc, player)
    const mainThird = getNodeByKey(body, 'hand:known:3')
    const overlayThird = getNodeByKey(overlay, 'hand:known:3')
    expect(getNodeByKey(body, 'hand:known:1')).toBe(mainFirst)
    expect(getNodeByKey(body, 'hand:known:2')).toBe(mainSecond)
    expect(getNodeByKey(overlay, 'hand:known:1')).toBe(overlayFirst)
    expect(getNodeByKey(overlay, 'hand:known:2')).toBe(overlaySecond)

    player.knownHandCards = [third, second]
    renderPlayerHand(doc, player)

    expect(getRenderedKeys(body)).toEqual(['hand:known:3', 'hand:known:2'])
    expect(getRenderedKeys(overlay)).toEqual(['hand:known:3', 'hand:known:2'])
    expect(body.children[0]).toBe(mainThird)
    expect(body.children[1]).toBe(mainSecond)
    expect(overlay.children[0]).toBe(overlayThird)
    expect(overlay.children[1]).toBe(overlaySecond)
    expect(mainFirst.parentElement).toBeNull()
    expect(overlayFirst.parentElement).toBeNull()
  })

  it('牌面签名或候选状态变化时只替换受影响节点', () => {
    const { doc, body } = createRenderHarness()
    const stable = createCard(1)
    const changing = createCard(2, '旧位置')
    const player = createPlayerFromCards(1, 1, [stable], [changing])

    renderPlayerHand(doc, player)
    const stableNode = getNodeByKey(body, 'hand:known:1')
    const candidateNode = getNodeByKey(body, 'hand:candidate:2')

    changing.getLocationDescription = () => '新位置'
    renderPlayerHand(doc, player)
    const updatedCandidateNode = getNodeByKey(body, 'hand:candidate:2')
    expect(getNodeByKey(body, 'hand:known:1')).toBe(stableNode)
    expect(updatedCandidateNode).not.toBe(candidateNode)
    expect(updatedCandidateNode.title).toBe('新位置')

    player.candidateHandCards = []
    player.knownHandCards = [stable, changing]
    renderPlayerHand(doc, player)
    const knownNode = getNodeByKey(body, 'hand:known:2')
    expect(getNodeByKey(body, 'hand:known:1')).toBe(stableNode)
    expect(knownNode).not.toBe(updatedCandidateNode)
    expect(knownNode.classList.contains('candidate-card')).toBe(false)
  })

  it('标记分组变化时只替换该分组并保持镜像无重复 id', () => {
    const { doc, body, overlay } = createRenderHarness()
    const handCard = createCard(1)
    const firstMark = createCard(2)
    const secondMark = createCard(3)
    const markCards = new Map([[290, [firstMark]]])
    const player = createPlayerFromCards(1, 1, [handCard], [], markCards)

    renderPlayerHand(doc, player)
    const mainHand = getNodeByKey(body, 'hand:known:1')
    const mainMark = getNodeByKey(body, 'mark:290')
    const overlayHand = getNodeByKey(overlay, 'hand:known:1')
    const overlayMark = getNodeByKey(overlay, 'mark:290')

    overlayMark.setAttribute('style', 'display: none')
    overlayMark.children
      .filter((child) => child.classList.contains('shoupai'))
      .forEach((child) => child.setAttribute('style', 'display: none'))
    renderPlayerHand(doc, player)
    expect(getNodeByKey(overlay, 'mark:290')).toBe(overlayMark)

    markCards.set(290, [firstMark, secondMark])
    renderPlayerHand(doc, player)

    expect(getNodeByKey(body, 'hand:known:1')).toBe(mainHand)
    expect(getNodeByKey(body, 'mark:290')).not.toBe(mainMark)
    expect(getNodeByKey(overlay, 'hand:known:1')).toBe(overlayHand)
    expect(getNodeByKey(overlay, 'mark:290')).not.toBe(overlayMark)
    expect(getNodeByKey(overlay, 'hand:known:1').id).toBe('')
    expect(getNodeByKey(overlay, 'mark:290').querySelectorAll('[id]')).toEqual([])
  })
})
