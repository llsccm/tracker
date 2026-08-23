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

  try {
    await navigator.clipboard.writeText(text)
    addTooltip('复制成功！')
    return true
  } catch (error) {
    console.info('Copy to clipboard failed.', error)
    return false
  }
}
