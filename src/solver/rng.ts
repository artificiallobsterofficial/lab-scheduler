/** Seeded PRNG (mulberry32) so a run with the same seed reproduces the same schedule. */
export interface Rng { next(): number; int(n: number): number; pick<T>(arr: T[]): T; shuffle<T>(arr: T[]): T[] }

export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: n => Math.floor(next() * n),
    pick: arr => arr[Math.floor(next() * arr.length)],
    shuffle: arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]] } return arr },
  }
}
