import { describe, expect, it } from 'vitest'

import {
  FIRST_KEY,
  OrderKeyError,
  byOrder,
  compareKeys,
  keyBetween,
  keysBetween,
} from './fractional'

/**
 * A seeded generator, so a failure reported by CI reproduces exactly here.
 * `Math.random()` would make these tests flaky in the worst way: passing until
 * the one run that finds the bug, then never again.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

describe('keyBetween', () => {
  it('places the first card of an empty column', () => {
    expect(keyBetween(null, null)).toBe(FIRST_KEY)
  })

  it('appends after a card', () => {
    const first = keyBetween(null, null)
    expect(keyBetween(first, null) > first).toBe(true)
  })

  it('prepends before a card', () => {
    const first = keyBetween(null, null)
    expect(keyBetween(null, first) < first).toBe(true)
  })

  it('lands strictly between two neighbours', () => {
    const a = keyBetween(null, null)
    const b = keyBetween(a, null)
    const mid = keyBetween(a, b)
    expect(a < mid).toBe(true)
    expect(mid < b).toBe(true)
  })

  it('refuses a reversed pair rather than returning a key that breaks sorting', () => {
    const a = keyBetween(null, null)
    const b = keyBetween(a, null)
    expect(() => keyBetween(b, a)).toThrow(OrderKeyError)
  })

  it('refuses to split a gap that does not exist', () => {
    const a = keyBetween(null, null)
    expect(() => keyBetween(a, a)).toThrow(OrderKeyError)
  })
})

describe('repeated insertion', () => {
  it('holds the invariant after a thousand inserts into the same gap', () => {
    // The pathological case for fractional indexing: always splitting the same
    // gap makes keys grow. Growth is fine; losing the ordering is not.
    let low = keyBetween(null, null)
    const high = keyBetween(low, null)

    for (let i = 0; i < 1000; i++) {
      const mid = keyBetween(low, high)
      expect(low < mid, `insert ${i}: ${low} < ${mid}`).toBe(true)
      expect(mid < high, `insert ${i}: ${mid} < ${high}`).toBe(true)
      low = mid
    }
  })

  it('keeps a list sorted through ten thousand random moves', () => {
    const random = seeded(20260807)
    let keys = keysBetween(null, null, 20).slice()

    for (let move = 0; move < 10_000; move++) {
      const from = Math.floor(random() * keys.length)
      const to = Math.floor(random() * (keys.length - 1))

      const moved = keys[from]!
      const without = keys.filter((_, index) => index !== from)
      const before = to > 0 ? (without[to - 1] ?? null) : null
      const after = without[to] ?? null

      // Moving a card onto itself is a no-op the UI never emits.
      if (before === moved || after === moved) continue

      const key = keyBetween(before, after)
      without.splice(to, 0, key)
      keys = without

      const sorted = keys.toSorted(compareKeys)
      expect(keys, `move ${move} left the list unsorted`).toEqual(sorted)
      expect(new Set(keys).size, `move ${move} produced a duplicate key`).toBe(keys.length)
    }
  })
})

describe('concurrent insertion', () => {
  it('lets two devices insert into the same gap without either being lost', () => {
    // Neither device has seen the other's write, so both compute from the same
    // neighbours. Both keys must still land in the gap, and they must differ.
    const left = keyBetween(null, null)
    const right = keyBetween(left, null)

    const deviceA = keyBetween(left, right)
    const deviceB = keyBetween(left, right)

    for (const key of [deviceA, deviceB]) {
      expect(left < key).toBe(true)
      expect(key < right).toBe(true)
    }

    // They collide, which is allowed — the merge orders them by id. What must
    // never happen is a key escaping the gap.
    const merged = [deviceA, deviceB].toSorted(compareKeys)
    expect(merged[0]! <= merged[1]!).toBe(true)
  })

  it('converges to the same order regardless of replay order', () => {
    const left = keyBetween(null, null)
    const right = keyBetween(left, null)

    const a = { id: 'item-a', order: keyBetween(left, right) }
    const b = { id: 'item-b', order: keyBetween(left, right) }

    const forwards = [a, b].toSorted(byOrder)
    const backwards = [b, a].toSorted(byOrder)

    expect(forwards).toEqual(backwards)
  })
})

describe('keysBetween', () => {
  it('returns nothing for a count of zero', () => {
    expect(keysBetween(null, null, 0)).toEqual([])
  })

  it('returns ascending keys inside the gap', () => {
    const left = keyBetween(null, null)
    const right = keyBetween(left, null)

    const keys = keysBetween(left, right, 50)

    expect(keys).toHaveLength(50)
    expect(keys.toSorted(compareKeys)).toEqual([...keys])
    expect(new Set(keys).size).toBe(50)
    for (const key of keys) {
      expect(left < key).toBe(true)
      expect(key < right).toBe(true)
    }
  })

  it('refuses a nonsensical count', () => {
    expect(() => keysBetween(null, null, -1)).toThrow(OrderKeyError)
    expect(() => keysBetween(null, null, 1.5)).toThrow(OrderKeyError)
  })
})

describe('byOrder', () => {
  it('breaks ties by id so every device agrees', () => {
    const items = [
      { id: 'c', order: 'a1' },
      { id: 'a', order: 'a1' },
      { id: 'b', order: 'a0' },
    ]
    expect(items.toSorted(byOrder).map((item) => item.id)).toEqual(['b', 'a', 'c'])
  })
})
