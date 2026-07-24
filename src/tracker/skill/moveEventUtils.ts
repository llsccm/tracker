type MoveEventDraft = any

export function getRaw(event: MoveEventDraft): any {
  return event.raw ?? event.options?.sourceEvent?.raw ?? {}
}

export function getCount(event: MoveEventDraft): number {
  return Math.max(0, Number(event.cardCount ?? event.options?.cardCount ?? 0))
}

export function hasPositiveID(cardIDs: any[] = []): boolean {
  return cardIDs.some((id) => id > 0)
}
