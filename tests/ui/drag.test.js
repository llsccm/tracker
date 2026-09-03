import { afterEach, describe, expect, it, vi } from 'vitest'
import { initDragElement } from '../../src/ui/drag'

describe('主面板拖动', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('使用布局视口宽度计算拖动边界', () => {
    const documentListeners = new Map()
    const draggableListeners = new Map()
    const container = {
      style: {},
      getBoundingClientRect: () => ({ left: 700, top: 31, width: 230 })
    }
    const draggable = {
      id: 'header',
      style: {},
      addEventListener(type, listener) {
        draggableListeners.set(type, listener)
      }
    }
    const sidebarHint = { style: {} }
    const document = {
      documentElement: { clientWidth: 1000 },
      body: { classList: { add: vi.fn(), remove: vi.fn() } },
      getElementById(id) {
        if (id === 'header') return draggable
        if (id === 'tracker-shell') return container
        if (id === 'sidebarHint') return sidebarHint
        return null
      },
      addEventListener(type, listener) {
        const listeners = documentListeners.get(type) ?? []
        listeners.push(listener)
        documentListeners.set(type, listeners)
      },
      removeEventListener: vi.fn()
    }

    vi.stubGlobal('document', document)
    vi.stubGlobal('window', { innerWidth: 640, innerHeight: 800 })
    vi.stubGlobal('requestAnimationFrame', (callback) => callback())

    initDragElement({ padding: 0 }, { closeIframe: false }, vi.fn())
    draggableListeners.get('mousedown')({ clientX: 800, clientY: 100 })
    documentListeners.get('mousemove')[0]({ clientX: 750, clientY: 120 })

    expect(container.style.transform).toBe('translate(-50px, 20px)')
  })
})
