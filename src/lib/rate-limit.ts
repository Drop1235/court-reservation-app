// Shared rate limit using Netlify Blobs with in-memory fallback.
// Allows at most 1 hit per `windowMs` for a given key. Returns true if rate-limited.

const mem = new Map<string, number>()

function memHit(key: string, windowMs: number): boolean {
  const now = Date.now()
  const last = mem.get(key) || 0
  if (now - last < windowMs) return true
  mem.set(key, now)
  return false
}

export async function rateLimitOnce(key: string, windowMs: number): Promise<boolean> {
  // Try Netlify Blobs first (shared across instances). Fallback to memory.
  try {
    // Dynamically import so local dev without the package still works
    // @ts-ignore - types may not be present locally; runtime import is safe on Netlify
    const mod: any = await import('@netlify/blobs')
    const getStore: ((name: string) => any) | undefined = (mod && (mod.getStore || (mod as any).blobs?.getStore)) as any
    if (!getStore) return memHit(key, windowMs)
    const store = getStore('rate-limit')
    // If a key exists, we're throttled. Otherwise set with TTL.
    const existing = await store.get(key)
    if (existing) return true
    const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000))
    await store.set(key, '1', { ttl: ttlSeconds })
    return false
  } catch {
    return memHit(key, windowMs)
  }
}
