import {
  clearProtocolRecording,
  exportProtocolRecording,
  initializeProtocolRecording,
  startProtocolRecording,
  stopProtocolRecording,
  subscribeProtocolRecordingStatus,
  type ProtocolRecordingStatus
} from '../tracker/runtime/protocolRecorder'
import { addTooltip } from '../utils/notification'

let recordingSwitch: HTMLInputElement | null = null
let exportButton: HTMLButtonElement | null = null
let clearButton: HTMLButtonElement | null = null
let statusElement: HTMLElement | null = null
let unsubscribeStatus: (() => void) | null = null

export function bindProtocolRecorderControls(): void {
  unbindProtocolRecorderControls()

  recordingSwitch = document.getElementById('protocolRecordSwitch') as HTMLInputElement | null
  exportButton = document.getElementById('protocolRecordExport') as HTMLButtonElement | null
  clearButton = document.getElementById('protocolRecordClear') as HTMLButtonElement | null
  statusElement = document.getElementById('protocolRecordStatus')

  if (!recordingSwitch || !exportButton || !clearButton || !statusElement) return

  recordingSwitch.onchange = handleRecordingSwitchChange
  exportButton.onclick = handleExportClick
  clearButton.onclick = handleClearClick
  unsubscribeStatus = subscribeProtocolRecordingStatus(renderProtocolRecordingStatus)
  void initializeProtocolRecording()
}

export function unbindProtocolRecorderControls(): void {
  if (recordingSwitch) recordingSwitch.onchange = null
  if (exportButton) exportButton.onclick = null
  if (clearButton) clearButton.onclick = null
  unsubscribeStatus?.()

  recordingSwitch = null
  exportButton = null
  clearButton = null
  statusElement = null
  unsubscribeStatus = null
}

function handleRecordingSwitchChange(): void {
  if (!recordingSwitch) return

  if (recordingSwitch.checked) {
    startProtocolRecording()
    addTooltip('已开始录制记牌协议，新的录制会覆盖上一次记录', 'acTooltip', 4000)
    return
  }

  void stopProtocolRecording()
    .then(({ count }) => {
      addTooltip(`已停止协议录制，共保存 ${count} 条`, 'acTooltip', 4000)
    })
    .catch((error) => {
      console.warn('[protocol-recorder] 停止协议录制失败', error)
      try {
        addTooltip('停止协议录制失败，请查看控制台', 'acTooltip', 4000)
      } catch (tooltipError) {
        console.warn('[protocol-recorder] 停止录制失败提示未能显示', tooltipError)
      }
    })
}

async function handleExportClick(): Promise<void> {
  try {
    const exported = await exportProtocolRecording()
    addTooltip(exported ? '记牌协议已导出' : '没有可导出的协议记录', 'acTooltip', 4000)
  } catch (error) {
    console.warn('[protocol-recorder] 协议导出失败', error)
    addTooltip('协议导出失败，请查看控制台', 'acTooltip', 4000)
  }
}

async function handleClearClick(): Promise<void> {
  await clearProtocolRecording()
  addTooltip('已清空协议记录', 'acTooltip', 4000)
}

function renderProtocolRecordingStatus(status: ProtocolRecordingStatus): void {
  if (!recordingSwitch || !exportButton || !clearButton || !statusElement) return

  recordingSwitch.checked = status.active
  exportButton.disabled = status.active || status.count === 0
  clearButton.disabled = status.active || status.count === 0
  statusElement.dataset.recording = String(status.active)

  if (status.active) {
    statusElement.textContent = `录制中：${status.count} 条`
    return
  }

  if (status.limitReached) {
    statusElement.textContent = `已达上限：${status.count} 条`
    return
  }

  statusElement.textContent = status.count > 0 ? `已保存：${status.count} 条` : '未录制'
}
