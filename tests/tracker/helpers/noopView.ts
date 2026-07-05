import type { Room } from '@/tracker/Room'
import type { TrackerView } from '@/tracker/types'

export const noopView: TrackerView = {
  mount(_room: Room) {},
  unmount() {},
  scheduleRender() {}
}
