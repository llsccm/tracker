export {}

declare global {
  interface Window {
    XC?: EventTarget & {
      moveType?: Record<string, unknown>
      Rpvp?: unknown[]
      [key: string]: unknown
    }
    padding?: unknown
  }

  const unsafeWindow: Window | undefined
  const __VERSION__: string
}
