import { installTraversalStatsBrowserControl } from './traversalStatsBrowser'

if (import.meta.env.DEV && typeof window !== 'undefined') {
  installTraversalStatsBrowserControl(window)
}

export { setTrackerSeatUIReader, tracker } from './bridge'
export { installTraversalStatsBrowserControl } from './traversalStatsBrowser'
export { uninstallTraversalStatsBrowserControl } from './traversalStatsBrowser'
