export const POSITION_BOTTOM = 0 as const
export const POSITION_TOP = 0xff00 as const
export const POSITION_RANDOM = 0xff02 as const

export type CardPosition = typeof POSITION_BOTTOM | typeof POSITION_TOP | typeof POSITION_RANDOM
