import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import type { LocationCandidateInput } from '@/tracker/candidate/locationCandidate'
import type { Card } from '@/tracker/model/Card'
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
  spellID: SpellID | null = null
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
  count: number | null = null
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
  spellID: SpellID | null
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

export function locationKeys(card: Pick<Card, 'locationCandidates'>): string[] {
  return card.locationCandidates.map((candidate) => createLocationCandidateKey(candidate)).sort()
}
