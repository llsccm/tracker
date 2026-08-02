export interface StorageAdapter {
  getItem(key: string): string | null | undefined
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type ConfigEntry = readonly [key: string, id: string, defaultValue: unknown]
export type ConfigEffects = Record<string, ((value: unknown) => void) | undefined>
export type ConfigStore = Record<PropertyKey, unknown>

interface ConfigStoreOptions {
  entries?: readonly ConfigEntry[]
  storage?: StorageAdapter
  eventTarget?: EventTarget | null
  effects?: ConfigEffects
}

export const ACTIVE_CONFIG_ENTRIES: readonly ConfigEntry[] = [
  ['padding', 'PADDING', 0],
  ['seatUISwitch', 'SEAT_UI_SWITCH', true],
  ['rogueCitySwitch', 'ROGUE_CITY_SWITCH', true],
  ['cardLabelSwitch', 'CARD_LABEL_SWITCH', false],
  ['debugLogSwitch', 'DEBUG_LOG_SWITCH', false],
  ['peiXiuMapSwitch', 'PEIXIU_MAP_SWITCH', true],
  ['effectBlockSwitch', 'EFFECT_BLOCK_SWITCH', false],
  ['blockKillEffectSwitch', 'BLOCK_KILL_EFFECT_SWITCH', false],
  ['blockSkinStateSwitch', 'BLOCK_SKIN_STATE_SWITCH', false],
  ['skipAdWindowSwitch', 'SKIP_AD_WINDOW_SWITCH', true],
  ['skipPackageWindowSwitch', 'SKIP_PACKAGE_WINDOW_SWITCH', true],
  ['blockMvpSettlementSwitch', 'BLOCK_MVP_SETTLEMENT_SWITCH', false]
]

export function createMemoryStorageAdapter(seed: Record<string, unknown> = {}): StorageAdapter {
  const data = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]))

  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key) : null
    },
    setItem(key: string, value: string) {
      data.set(key, value)
    },
    removeItem(key: string) {
      data.delete(key)
    }
  }
}

export function createBrowserStorageAdapter(storage: StorageAdapter | null = null): StorageAdapter {
  return storage ?? createMemoryStorageAdapter()
}

function readStoredValue(storage: StorageAdapter, id: string, defaultValue: unknown): unknown {
  let rawValue: string | null | undefined
  try {
    rawValue = storage.getItem(id)
  } catch {
    return defaultValue
  }

  if (rawValue === null) {
    writeStoredValue(storage, id, defaultValue)
    return defaultValue
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    writeStoredValue(storage, id, defaultValue)
    return defaultValue
  }
}

function writeStoredValue(storage: StorageAdapter, id: string, value: unknown): boolean {
  try {
    storage.setItem(id, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function createConfigStore({
  entries = ACTIVE_CONFIG_ENTRIES,
  storage = createMemoryStorageAdapter(),
  eventTarget = null,
  effects = {}
}: ConfigStoreOptions = {}): ConfigStore {
  const configMetaMap = new Map(
    entries.map(([key, id, defaultValue]) => [key, { id, defaultValue }])
  )
  const initialData: ConfigStore = Object.fromEntries(
    Array.from(configMetaMap.entries()).map(([key, { id, defaultValue }]) => [
      key,
      readStoredValue(storage, id, defaultValue)
    ])
  )

  return new Proxy(initialData, {
    get(target, property) {
      if (typeof property !== 'string') return target[property]
      const meta = configMetaMap.get(property)
      if (!meta) return target[property]

      const latestValue = readStoredValue(storage, meta.id, target[property])
      target[property] = latestValue
      return latestValue
    },

    set(target, property, value) {
      if (typeof property !== 'string') return false
      const meta = configMetaMap.get(property)
      if (!meta) return false

      const oldValue = target[property]
      if (oldValue === value) return true

      if (!writeStoredValue(storage, meta.id, value)) return false
      target[property] = value

      effects[property]?.(value)

      if (eventTarget && typeof CustomEvent !== 'undefined') {
        eventTarget.dispatchEvent(
          new CustomEvent('xc:config-change', {
            detail: {
              property,
              value,
              oldValue
            }
          })
        )
      }
      return true
    }
  })
}
