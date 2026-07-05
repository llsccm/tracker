import { user } from '../context'
import { addTooltip } from './notification'

export const ADVANCED_FEATURES = Object.freeze({
  hpColor: '灼魂小抄',
  quanyu: '权御小抄',
  peixiu: '裴秀小抄'
})

const TRIAL_FEATURE_KEYS = Object.keys(ADVANCED_FEATURES)
const TRIAL_RATE = 0.2

const advancedFeatureState = {
  gameID: 0,
  enabled: false,
  notified: new Set()
}

function isAdvancedFeatureKey(key) {
  return Object.prototype.hasOwnProperty.call(ADVANCED_FEATURES, key)
}

function getTrialSnapshot() {
  return Object.fromEntries(TRIAL_FEATURE_KEYS.map((key) => [key, advancedFeatureState.enabled]))
}

export function resetAdvancedFeatureTrial() {
  advancedFeatureState.gameID += 1
  advancedFeatureState.notified.clear()
  advancedFeatureState.enabled = !user.v && Math.random() < TRIAL_RATE
  return getTrialSnapshot()
}

export function clearAdvancedFeatureTrial() {
  advancedFeatureState.enabled = false
  advancedFeatureState.notified.clear()
}

export function hasAdvancedFeature(key) {
  return isAdvancedFeatureKey(key) && (!!user.v || advancedFeatureState.enabled)
}

export function notifyAdvancedFeatureTrial(key) {
  if (
    user.v ||
    !advancedFeatureState.enabled ||
    !isAdvancedFeatureKey(key) ||
    advancedFeatureState.notified.has(key)
  )
    return
  advancedFeatureState.notified.add(key)
  addTooltip(
    `${ADVANCED_FEATURES[key]}正在试用中<br>支持我们可使用完整版`,
    `advanced-trial-tip-${key}`,
    10000,
    '',
    null
  )
}

export function getAdvancedFeatureTrialState() {
  return {
    gameID: advancedFeatureState.gameID,
    enabled: advancedFeatureState.enabled,
    trial: getTrialSnapshot(),
    notified: Array.from(advancedFeatureState.notified)
  }
}
