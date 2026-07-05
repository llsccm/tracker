import { openLink } from '@/utils'

let tooltipDelegationBound = false
let activeTooltipTarget = null
let activeTooltipElement = null

function getReusableTooltip() {
  if (!activeTooltipElement) {
    activeTooltipElement = document.createElement('div')
    activeTooltipElement.classList.add('tooltip', 'top')
    document.body.appendChild(activeTooltipElement)
  } else if (!activeTooltipElement.isConnected) {
    document.body.appendChild(activeTooltipElement)
  }
  return activeTooltipElement
}

function hideReusableTooltip() {
  if (!activeTooltipElement) return
  if (
    typeof activeTooltipElement.hidePopover == 'function' &&
    activeTooltipElement.matches?.(':popover-open')
  ) {
    activeTooltipElement.hidePopover()
  }
  activeTooltipElement.classList.remove('visible', 'dialog-tooltip')
  activeTooltipElement.style.visibility = 'hidden'
  activeTooltipElement.style.left = '-9999px'
  activeTooltipElement.style.top = '-9999px'
  activeTooltipTarget = null
}

function showReusableTooltip(mark) {
  const text = mark?.getAttribute?.('data-tooltip')
  if (!text) return
  const tooltip = getReusableTooltip()
  const isPopoverTooltip =
    !!mark.closest('dialog[open]') && typeof tooltip.showPopover == 'function'
  if (typeof tooltip.hidePopover == 'function' && tooltip.matches?.(':popover-open'))
    tooltip.hidePopover()
  tooltip.className = 'tooltip top'
  tooltip.textContent = text
  tooltip.style.maxWidth = ''
  tooltip.style.visibility = 'hidden'
  tooltip.style.left = '-9999px'
  tooltip.style.top = '-9999px'
  if (isPopoverTooltip) tooltip.setAttribute('popover', 'manual')
  else {
    tooltip.removeAttribute('popover')
    tooltip.classList.toggle('dialog-tooltip', !!mark.closest('dialog[open]'))
  }
  const boundsEl = isPopoverTooltip ? null : mark.closest('.panel-content, .body')
  const boundsRect = boundsEl?.getBoundingClientRect()
  if (boundsRect && boundsRect.width > 40) {
    tooltip.style.maxWidth = `${Math.min(200, Math.max(120, boundsRect.width - 12))}px`
  }
  if (isPopoverTooltip) tooltip.showPopover()
  const anchor = mark.querySelector('.switch') || mark
  const rect = anchor.getBoundingClientRect()
  const minLeft = boundsRect ? boundsRect.left + 4 : 8
  const maxLeft = boundsRect
    ? boundsRect.right - tooltip.offsetWidth - 4
    : window.innerWidth - tooltip.offsetWidth - 8
  const minTop = boundsRect ? boundsRect.top + 4 : 8
  const left = Math.max(
    minLeft,
    Math.min(maxLeft, rect.left + rect.width / 2 - tooltip.offsetWidth / 2)
  )
  let top = rect.top - tooltip.offsetHeight - 8
  if (top < minTop) top = rect.bottom + 8
  top = Math.max(minTop, top)
  tooltip.style.left = `${left}px`
  tooltip.style.top = `${top}px`
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

export function bindExternalLinks() {
  document.querySelectorAll('.external-link').forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.preventDefault()
      const url = link.dataset.url
      openLink(url)
    })
  })
}
