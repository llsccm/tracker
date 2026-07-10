let tooltipDelegationBound = false
let activeTooltipTarget = null
let activeTooltipElement = null

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getReusableTooltip(owner = document.body) {
  if (!activeTooltipElement) {
    activeTooltipElement = document.createElement('div')
    activeTooltipElement.classList.add('tooltip', 'top')
    owner.appendChild(activeTooltipElement)
  } else if (!activeTooltipElement.isConnected || activeTooltipElement.parentElement !== owner) {
    owner.appendChild(activeTooltipElement)
  }
  return activeTooltipElement
}

function hideReusableTooltip() {
  if (!activeTooltipElement) return
  activeTooltipElement.classList.remove('visible', 'dialog-tooltip')
  activeTooltipElement.style.visibility = 'hidden'
  activeTooltipElement.style.left = '-9999px'
  activeTooltipElement.style.top = '-9999px'
  activeTooltipTarget = null
}

function prepareTooltip(mark, dialog) {
  const tooltip = getReusableTooltip(dialog || document.body)
  tooltip.className = dialog ? 'tooltip top dialog-tooltip' : 'tooltip top'
  tooltip.textContent = mark.getAttribute('data-tooltip')
  tooltip.style.maxWidth = ''
  tooltip.style.visibility = 'hidden'
  tooltip.style.left = '-9999px'
  tooltip.style.top = '-9999px'
  tooltip.removeAttribute('popover')
  return tooltip
}

function positionTooltip({ tooltip, anchor, dialog }) {
  const rect = anchor.getBoundingClientRect()
  const boundsRect = dialog?.getBoundingClientRect()
  const offset = 8
  const padding = 4

  if (dialog && boundsRect) {
    tooltip.style.maxWidth = `${Math.min(200, Math.max(120, boundsRect.width - padding * 2))}px`
    const left = clamp(
      rect.left - boundsRect.left + rect.width / 2 - tooltip.offsetWidth / 2,
      padding,
      Math.max(padding, boundsRect.width - tooltip.offsetWidth - padding)
    )
    let top = rect.top - boundsRect.top - tooltip.offsetHeight - offset
    if (top < padding) top = rect.bottom - boundsRect.top + offset
    top = clamp(top, padding, Math.max(padding, boundsRect.height - tooltip.offsetHeight - padding))
    tooltip.style.left = `${left}px`
    tooltip.style.top = `${top}px`
    return
  }

  const left = clamp(
    rect.left + rect.width / 2 - tooltip.offsetWidth / 2,
    offset,
    Math.max(offset, window.innerWidth - tooltip.offsetWidth - offset)
  )
  let top = rect.top - tooltip.offsetHeight - offset
  if (top < offset) top = rect.bottom + offset
  tooltip.style.left = `${left}px`
  tooltip.style.top = `${top}px`
}

function showReusableTooltip(mark) {
  const text = mark?.getAttribute?.('data-tooltip')
  if (!text) return

  const dialog = mark.closest('dialog[open]')
  const tooltip = prepareTooltip(mark, dialog)
  const anchor = mark.querySelector('.switch') || mark
  positionTooltip({ tooltip, anchor, dialog })
  tooltip.style.visibility = ''
  tooltip.classList.add('visible')
  activeTooltipTarget = mark
}

export function bindDelegatedTooltips() {
  if (tooltipDelegationBound) return
  tooltipDelegationBound = true

  document.addEventListener('mouseover', (event) => {
    const mark = event.target?.closest?.('.switch-container, .calRes')
    if (!mark || !mark.getAttribute('data-tooltip') || mark.contains(event.relatedTarget)) return
    showReusableTooltip(mark)
  })

  document.addEventListener('mouseout', (event) => {
    const mark = event.target?.closest?.('.switch-container, .calRes')
    if (!mark || mark !== activeTooltipTarget || mark.contains(event.relatedTarget)) return
    hideReusableTooltip()
  })
}
