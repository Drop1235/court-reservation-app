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
        // Ensure delivery before the serverless function exits
        if (S && typeof (S as any).flush === 'function') {
          try { await (S as any).flush(2000) } catch {}
        }
      }
    } catch {
      // swallow errors
    }
  })()
}

// Capture error with minimal request context so that Sentry UI shows request.url, headers, etc.
export function captureErrorWithRequest(req: Request, err: unknown) {
  if (!DSN) return
  ;(async () => {
    try {
      await ensureInit()
      if (S && typeof (S as any).withScope === 'function') {
        ;(S as any).withScope((scope: any) => {
          try {
            const headers: Record<string, string> = {}
            for (const [k, v] of (req.headers as any).entries()) headers[k] = String(v)
            // Prefer a dedicated context for request
            scope.setContext('request', {
              url: req.url,
              method: (req as any).method || 'GET',
              headers,
            })
            // Also add tags/extras to guarantee visibility in UI
            scope.setTag('request_url', req.url)
            scope.setTag('request_method', (req as any).method || 'GET')
            scope.setExtra('request_headers', headers)
          } catch {}
          ;(S as any).captureException(err)
        })
        // Ensure delivery before the serverless function exits
        if (S && typeof (S as any).flush === 'function') {
          try { await (S as any).flush(2000) } catch {}
        }
      } else if (S && typeof (S as any).captureException === 'function') {
        ;(S as any).captureException(err)
        if (S && typeof (S as any).flush === 'function') {
          try { await (S as any).flush(2000) } catch {}
        }
      }
    } catch {
      // swallow errors
    }
  })()
}
