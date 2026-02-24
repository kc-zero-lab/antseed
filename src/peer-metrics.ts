import type { PeerMetrics } from './peer-scorer.js'

export interface PeerMetricsTrackerConfig {
  latencyAlpha?: number       // Default: 0.3
  maxFailures?: number        // Default: 3
  failureCooldownMs?: number  // Default: 30000
  now?: () => number
}

export class PeerMetricsTracker {
  private readonly _latencyMap = new Map<string, number>()
  private readonly _failureStreakMap = new Map<string, number>()
  private readonly _totalFailureMap = new Map<string, number>()
  private readonly _attemptMap = new Map<string, number>()
  private readonly _cooldownUntilMap = new Map<string, number>()

  private readonly _latencyAlpha: number
  private readonly _maxFailures: number
  private readonly _failureCooldownMs: number
  private readonly _now: () => number

  constructor(config?: PeerMetricsTrackerConfig) {
    this._latencyAlpha = config?.latencyAlpha ?? 0.3
    this._maxFailures = Math.max(1, config?.maxFailures ?? 3)
    this._failureCooldownMs = Math.max(1, config?.failureCooldownMs ?? 30_000)
    this._now = config?.now ?? (() => Date.now())
  }

  recordResult(peerId: string, result: { success: boolean; latencyMs: number }): void {
    const now = this._now()
    const attempts = (this._attemptMap.get(peerId) ?? 0) + 1
    this._attemptMap.set(peerId, attempts)

    if (result.success) {
      // Update latency EMA
      const prev = this._latencyMap.get(peerId) ?? result.latencyMs
      this._latencyMap.set(
        peerId,
        prev * (1 - this._latencyAlpha) + result.latencyMs * this._latencyAlpha,
      )
      // Reset failure count on success
      this._failureStreakMap.delete(peerId)
      this._cooldownUntilMap.delete(peerId)
    } else {
      const currentStreak = this._failureStreakMap.get(peerId) ?? 0
      const nextStreak = currentStreak + 1
      this._failureStreakMap.set(peerId, nextStreak)
      this._totalFailureMap.set(peerId, (this._totalFailureMap.get(peerId) ?? 0) + 1)

      if (nextStreak >= this._maxFailures) {
        const penaltyPower = Math.min(4, nextStreak - this._maxFailures)
        const cooldownMs = this._failureCooldownMs * (2 ** penaltyPower)
        this._cooldownUntilMap.set(peerId, now + cooldownMs)
      }
    }
  }

  getMetrics(peerId: string): PeerMetrics {
    return {
      latencyEma: this._latencyMap.get(peerId),
      failureStreak: this._failureStreakMap.get(peerId) ?? 0,
      totalFailures: this._totalFailureMap.get(peerId) ?? 0,
      totalAttempts: this._attemptMap.get(peerId) ?? 0,
      cooldownUntil: this._cooldownUntilMap.get(peerId),
    }
  }

  isCoolingDown(peerId: string): boolean {
    const now = this._now()
    const until = this._cooldownUntilMap.get(peerId)
    if (until === undefined) return false
    if (until <= now) {
      this._cooldownUntilMap.delete(peerId)
      return false
    }
    return true
  }

  getMedianLatency(): number {
    const values = [...this._latencyMap.values()]
    if (values.length === 0) return 500
    values.sort((a, b) => a - b)
    const mid = Math.floor(values.length / 2)
    return values.length % 2 === 0
      ? (values[mid - 1]! + values[mid]!) / 2
      : values[mid]!
  }
}
