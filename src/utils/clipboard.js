// import { laya } from '../runtime/gameAdapter'
import { addTooltip } from './notification'

const correction = [
  ['10', '⒑'],
  ['1', '⒈'],
  ['2', '⒉'],
  ['3', '⒊'],
  ['4', '⒋'],
  ['5', '⒌'],
  ['6', '⒍'],
  ['7', '⒎'],
  ['8', '⒏'],
  ['9', '⒐'],
  ['J', 'Ⓙ'],
  ['Q', 'Ⓠ'],
  ['K', 'Ⓚ'],
  ['+', ' ']
]

export async function toClipboard(text, filter) {
  if (filter) {
    correction.forEach(([from, to]) => {
      text = text.replaceAll(from, to)
    })
  }

  // laya.chat(text) // 复制消息到聊天框

  // Internet Explorer-specific code path to prevent textarea being shown while dialog is visible.
  if (window?.clipboardData?.setData) {
    const copied = window.clipboardData.setData('Text', text)
    if (copied) addTooltip('复制成功！')
    return copied
  }

  if (document?.queryCommandSupported?.('copy')) {
    const textarea = document.createElement('textarea')
    textarea.textContent = text
    // Prevent scrolling to bottom of page in Microsoft Edge.
    textarea.style.position = 'fixed'
    document.body.appendChild(textarea)
    textarea.select()

    // Security exception may be thrown by some browsers.
    try {
      const copied = document.execCommand('copy')
      if (copied) addTooltip('复制成功！')
      return copied
    } catch (ex) {
      console.info('Copy to clipboard failed.', ex)
      return prompt('Copy to clipboard: Ctrl+C, Enter', text)
    } finally {
      document.body.removeChild(textarea)
    }
  }

  return false
}
