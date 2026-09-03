const TRACKER_ROOT_ID = 'tracker-shell'
const TRACKER_OVERLAY_SELECTOR = '#seatUI .shoupai, #seatUI .markedCard'

let trackerHidden = false
let shortcutBound = false

export function applyTrackerVisibility(targetDoc: Document = document): void {
  const trackerRoot = targetDoc.getElementById(TRACKER_ROOT_ID)
  if (trackerRoot) trackerRoot.style.display = trackerHidden ? 'none' : ''

  targetDoc.querySelectorAll<HTMLElement>(TRACKER_OVERLAY_SELECTOR).forEach((element) => {
    if (trackerHidden) {
      element.style.display = 'none'
    } else {
      element.style.removeProperty('display')
    }
  })
}

export function reapplyHiddenTrackerVisibility(targetDoc: Document = document): void {
  if (!trackerHidden) return
  applyTrackerVisibility(targetDoc)
}

export function bindTrackerVisibilityShortcut(): void {
  if (shortcutBound) return
  window.addEventListener('keydown', handleTrackerVisibilityShortcut, true)
  shortcutBound = true
  applyTrackerVisibility()
}

export function unbindTrackerVisibilityShortcut(): void {
  if (!shortcutBound) return
  window.removeEventListener('keydown', handleTrackerVisibilityShortcut, true)
  shortcutBound = false
  trackerHidden = false
}

function handleTrackerVisibilityShortcut(event: KeyboardEvent): void {
  const isHKey = event.code === 'KeyH' || event.key?.toLowerCase() === 'h'
  if (
    !isHKey ||
    !event.ctrlKey ||
    !event.shiftKey ||
    event.altKey ||
    event.metaKey ||
    event.repeat ||
    event.isComposing ||
    isEditableTarget(event.target)
  ) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  trackerHidden = !trackerHidden
  applyTrackerVisibility()
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  )
}
