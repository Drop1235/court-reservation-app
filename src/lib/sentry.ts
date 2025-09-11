// Minimal Sentry helper that auto-initializes when SENTRY_DSN is present.
// Uses dynamic import so that local/dev without the package still works.

const DSN = process.env.SENTRY_DSN
const ENV = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production'

let inited = false
let S: any | null = null

async function ensureInit() {
  if (!DSN || inited) return
  try {
    // @ts-ignore - types may not be present; dynamic import at runtime
    const mod = await import('@sentry/node')
    mod.init({ dsn: DSN, environment: ENV, tracesSampleRate: 0 })
    S = mod
    inited = true
  } catch {
    // ignore if dependency is unavailable; acts as no-op
  }
}

export function captureError(err: unknown) {
  if (!DSN) return
  ;(async () => {
    try {
      await ensureInit()
      if (S && typeof (S as any).captureException === 'function') {
        ;(S as any).captureException(err)
      }
    } catch {
      // swallow errors
    }
  })()
}
