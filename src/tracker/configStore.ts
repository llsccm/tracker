export interface StorageAdapter {
  getItem(key: string): string | null | undefined
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type ConfigEntry = readonly [key: string, id: string, defaultValue: unknown]

/** 配置副作用与对应配置项共享值类型。 */
export type ConfigEffects<TEntries extends readonly ConfigEntry[] = typeof ACTIVE_CONFIG_ENTRIES> =
  {
    [K in keyof ConfigStore<TEntries>]?: (value: ConfigStore<TEntries>[K]) => void
  }

type WidenConfigValue<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T

/** 由配置项元组推导出的配置对象类型，值类型取默认值宽化后的类型。 */
export type ConfigStore<TEntries extends readonly ConfigEntry[] = readonly ConfigEntry[]> = {
  -readonly [E in TEntries[number] as E[0]]-?: WidenConfigValue<E[2]>
}

interface ConfigStoreOptions<TEntries extends readonly ConfigEntry[] = readonly ConfigEntry[]> {
  entries?: TEntries
  storage?: StorageAdapter | null
  eventTarget?: EventTarget | null
  effects?: ConfigEffects<TEntries>
}

export const ACTIVE_CONFIG_ENTRIES = [
  ['padding', 'PADDING', 0],
  ['seatUISwitch', 'SEAT_UI_SWITCH', true],
  ['rogueCitySwitch', 'ROGUE_CITY_SWITCH', true],
  ['cardLabelSwitch', 'CARD_LABEL_SWITCH', false],
  ['showNameSwitch', 'SHOW_NAME_SWITCH', false],
  ['debugLogSwitch', 'DEBUG_LOG_SWITCH', false],
  ['peiXiuMapSwitch', 'PEIXIU_MAP_SWITCH', false],
  ['effectBlockSwitch', 'EFFECT_BLOCK_SWITCH', false],
  ['blockKillEffectSwitch', 'BLOCK_KILL_EFFECT_SWITCH', false],
  ['blockSkinStateSwitch', 'BLOCK_SKIN_STATE_SWITCH', false],
  ['skipAdWindowSwitch', 'SKIP_AD_WINDOW_SWITCH', true],
  ['skipPackageWindowSwitch', 'SKIP_PACKAGE_WINDOW_SWITCH', false],
  ['blockMvpSettlementSwitch', 'BLOCK_MVP_SETTLEMENT_SWITCH', false]
] as const

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

function readStoredValue(storage: StorageAdapter, id: string, defaultValue: unknown): unknown {
  let rawValue: string | null | undefined
  try {
    rawValue = storage.getItem(id)
  } catch {
    return defaultValue
  }

  if (rawValue == null) {
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

export function createConfigStore<
  TEntries extends readonly ConfigEntry[] = typeof ACTIVE_CONFIG_ENTRIES
>({
  entries = ACTIVE_CONFIG_ENTRIES as unknown as TEntries,
  storage = null,
  eventTarget = null,
  effects = {}
}: ConfigStoreOptions<TEntries> = {}): ConfigStore<TEntries> {
  const resolvedStorage = storage ?? createMemoryStorageAdapter()
  const configMetaMap = new Map(
    entries.map(([key, id, defaultValue]) => [key, { id, defaultValue }])
  )
  const initialData = Object.fromEntries(
    Array.from(configMetaMap.entries()).map(([key, { id, defaultValue }]) => [
      key,
      readStoredValue(resolvedStorage, id, defaultValue)
    ])
  ) as Record<PropertyKey, unknown>

  const store = new Proxy(initialData, {
    get(target, property) {
      if (typeof property !== 'string') return target[property]
      const meta = configMetaMap.get(property)
      if (!meta) return target[property]

      const latestValue = readStoredValue(resolvedStorage, meta.id, target[property])
      target[property] = latestValue
      return latestValue
    },

    set(target, property, value) {
      if (typeof property !== 'string') return false
      const meta = configMetaMap.get(property)
      if (!meta) return false

      const oldValue = target[property]
      if (oldValue === value) return true

      if (!writeStoredValue(resolvedStorage, meta.id, value)) return false
      target[property] = value

      effects[property as keyof ConfigStore<TEntries>]?.(value)

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

  return store as ConfigStore<TEntries>
}
