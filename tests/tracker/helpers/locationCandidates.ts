import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import type { LocationCandidateInput } from '@/tracker/candidate/locationCandidate'
import type { Card } from '@/tracker/Card'
import type {
  CardID,
  PublicPosition,
  PublicZoneName,
  SeatID,
  SpellID,
  SubZone
} from '@/tracker/types'

export function playerLocation(
  seatID: SeatID,
  subZone: SubZone,
  spellID: SpellID | string | null = null
): LocationCandidateInput {
  return {
    type: 'player',
    seatID,
    subZone,
    spellID
  }
}

export function playerHand(seatID: SeatID): LocationCandidateInput {
  return playerLocation(seatID, 'hand')
}

export function publicLocation(
  zone: PublicZoneName,
  position: PublicPosition = 'any',
  count: number | string | null = null
): LocationCandidateInput {
  return {
    type: 'public',
    zone,
    position,
    count
  }
}

export function equipmentContainer(
  cardID: CardID,
  spellID: SpellID | string | null
): LocationCandidateInput {
  return {
    type: 'container',
    containerType: 'equipment',
    cardID,
    spellID
  }
}

export function outsideLocation(zone: PublicZoneName = 'outside'): LocationCandidateInput {
  return {
    type: 'outside',
    zone
  }
}

export function locationKeys(card: Pick<Card, 'getLocationCandidates'>): string[] {
  return card
    .getLocationCandidates()
    .map((candidate) => createLocationCandidateKey(candidate))
    .sort()
}
