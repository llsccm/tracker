import type { TraversalStatsBrowserControl } from '@/tracker/runtime/traversalStatsBrowser'

export {}

declare global {
  interface Window {
    XC?: EventTarget & {
      moveType?: Record<string, unknown>
      Rpvp?: unknown[]
      [key: string]: unknown
    }
    padding?: unknown
    __DXC_TRAVERSAL__?: TraversalStatsBrowserControl
  }

  const unsafeWindow: Window | undefined
  const __VERSION__: string
}
