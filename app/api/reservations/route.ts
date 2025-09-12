export const runtime = 'nodejs'
import { prisma } from '@/src/lib/prisma'
import { requireUser } from '@/src/lib/auth'
import { assertServerReservationValidity, overlaps } from '@/src/lib/time'
import { normalizeNames } from '@/src/lib/text'
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { rateLimitOnce } from '@/src/lib/rate-limit'
import { captureError } from '@/src/lib/sentry'

// Rate limit window
const RL_WINDOW_MS = 10_000 // 10 seconds per key
function clientKey(req: Request): string {
  try {
    const ip = (req.headers.get('x-nf-client-connection-ip')
      || req.headers.get('x-forwarded-for')
      || req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || '')
      .split(',')[0]
      .trim()
    const ua = req.headers.get('user-agent') || ''
    return ip || ua || 'unknown'
  } catch {
    return 'unknown'
  }

// Simple in-memory idempotency storage (per serverless instance)
const idemStore = new Map<string, { body: any; status: number; ts: number }>()
const IDEM_TTL_MS = 10 * 60 * 1000 // 10 minutes
function getIdemKey(req: Request): string | null {
  const k = req.headers.get('idempotency-key') || req.headers.get('x-idempotency-key')
  return k ? k.trim() : null
}
function sweepIdem() {
  const now = Date.now()
  for (const [k, v] of idemStore.entries()) {
    if (now - v.ts > IDEM_TTL_MS) idemStore.delete(k)
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date') // yyyy-mm-dd
    const courtId = searchParams.get('courtId')

    // TEMP: Sentry verification flag. Access /api/reservations?__testError=1 to emit a test error.
    // Remove this block after confirming Sentry Issues receives the event.
    if (searchParams.get('__testError') === '1') {
      throw new Error('Sentry test error (manual trigger)')
    }

    // If date provided: filter by day (and optional court)
    if (date) {
      const startOfDay = new Date(date + 'T00:00:00.000Z')
      const endOfDay = new Date(date + 'T23:59:59.999Z')
      const where: any = { date: { gte: startOfDay, lte: endOfDay } }
      if (courtId) where.courtId = Number(courtId)
      const reservations = await prisma.reservation.findMany({ where })
      const payload = JSON.stringify(reservations)
      const etag = 'W/"' + crypto.createHash('sha1').update(payload).digest('hex') + '"'
      const ifNoneMatch = req.headers.get('if-none-match')
      if (ifNoneMatch && ifNoneMatch === etag) {
        const res304 = new NextResponse(null, { status: 304 })
        res304.headers.set('ETag', etag)
        res304.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30')
        res304.headers.set('X-ETag-Calc', etag)
        res304.headers.set('X-Cache-Intent', 'public-30')
        return res304
      }
      const res = new NextResponse(payload, { headers: { 'Content-Type': 'application/json' } })
      res.headers.set('ETag', etag)
      res.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30')
      res.headers.set('X-ETag-Calc', etag)
      res.headers.set('X-Cache-Intent', 'public-30')
      return res
    }

    // If no date provided: return all reservations publicly (no auth)
    const reservations = await prisma.reservation.findMany({})
    const payload = JSON.stringify(reservations)
    const etag = 'W/"' + crypto.createHash('sha1').update(payload).digest('hex') + '"'
    const ifNoneMatch = req.headers.get('if-none-match')
    if (ifNoneMatch && ifNoneMatch === etag) {
      const res304 = new NextResponse(null, { status: 304 })
      res304.headers.set('ETag', etag)
      res304.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30')
      res304.headers.set('X-ETag-Calc', etag)
      res304.headers.set('X-Cache-Intent', 'public-30')
      return res304
    }
    const res = new NextResponse(payload, { headers: { 'Content-Type': 'application/json' } })
    res.headers.set('ETag', etag)
    res.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30')
    res.headers.set('X-ETag-Calc', etag)
    res.headers.set('X-Cache-Intent', 'public-30')
    return res
  } catch (e: any) {
    captureError(e)
    return NextResponse.json({ error: e?.message ?? 'Failed to fetch reservations' }, { status: 400 })
  }
}

export async function POST(req: Request) {
  try {
    // Best-effort IP-based rate limiting to reduce bursts
    const key = clientKey(req)
    if (await rateLimitOnce(`post:${key}`, RL_WINDOW_MS)) {
      return NextResponse.json({ error: 'リクエストが多すぎます。数秒後に再度お試しください。' }, { status: 429 })
    }

    // Idempotency-Key handling (best-effort per instance)
    sweepIdem()
    const idemKey = getIdemKey(req)
    if (idemKey && idemStore.has(idemKey)) {
      const cached = idemStore.get(idemKey)!
      return NextResponse.json(cached.body, { status: cached.status })
    }

    // Try to use the logged-in user; if not logged in, fall back to a default seeded user
    let userId: string
    try {
      const user = await requireUser()
      userId = user.id
    } catch {
      // Avoid upsert to minimize prepared statement conflicts under pgBouncer
      let guest = await prisma.user.findFirst({ where: { email: 'user@example.com' } })
      if (!guest) {
        try {
          guest = await prisma.user.create({ data: { email: 'user@example.com' } })
        } catch (err: any) {
          // If a race created the user concurrently, fetch again
          guest = await prisma.user.findFirst({ where: { email: 'user@example.com' } })
        }
      }
      userId = guest!.id
    }
    const body = await req.json()
    const { courtId, date, startMin, endMin, partySize, playerNames } = body as {
      courtId: number
      date: string
      startMin: number
      endMin: number
      partySize: number
      playerNames: string[]
    }

    if (!courtId || !date) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    if (!Array.isArray(playerNames)) return NextResponse.json({ error: 'Player names are required' }, { status: 400 })
    const cleaned = normalizeNames(playerNames)
    if (cleaned.length !== partySize) {
      return NextResponse.json({ error: '人数分の氏名を入力してください' }, { status: 400 })
    }
    assertServerReservationValidity(startMin, endMin, partySize)

    const dayStart = new Date(date + 'T00:00:00.000Z')

    // Rule: A person can only hold one active (not-yet-finished) reservation at a time.
    // Allow booking again only after the previous reservation end time has passed.
    try {
      const now = new Date()
      const todayUTCStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      const nowMinUTC = now.getUTCHours() * 60 + now.getUTCMinutes()

      // Fetch active reservations regardless of stored name formatting
      const existingActive = await prisma.reservation.findMany({
        where: {
          OR: [
            { date: { gt: todayUTCStart } },
            { AND: [{ date: todayUTCStart }, { endMin: { gt: nowMinUTC } }] },
          ],
        },
      })

      // Compare using normalized names to absorb width/space variations
      const cleanedSet = new Set(cleaned.map((n) => n))
      const conflict = existingActive.some((r) => {
        // Access playerNames with a safe cast to tolerate stale Prisma types
        const names = (r as any).playerNames as string[] | undefined
        const norm = normalizeNames(Array.isArray(names) ? names : [])
        return norm.some((n) => cleanedSet.has(n))
      })

      if (conflict) {
        return NextResponse.json(
          { error: '同時に複数の予約はできません。現在の予約が終了してから、再度ご予約ください。' },
          { status: 400 },
        )
      }
    } catch (checkErr: any) {
      // If the check fails unexpectedly, fail closed with a helpful message instead of proceeding.
      return NextResponse.json({ error: '予約状態の確認に失敗しました。時間をおいて再度お試しください。' }, { status: 400 })
    }

    // Capacity check: sum of overlapping reservations' partySize for same court must be <= 4
    const sameDay = await prisma.reservation.findMany({
      where: { courtId, date: { gte: dayStart, lte: new Date(dayStart.getTime() + 24 * 3600 * 1000 - 1) } },
    })

    const used = sameDay
      .filter((r: { startMin: number; endMin: number; partySize: number }) => overlaps(r.startMin, r.endMin, startMin, endMin))
      .reduce((acc: number, r: { partySize: number }) => acc + r.partySize, 0)

    if (used + partySize > 4) {
      return NextResponse.json({ error: 'Capacity exceeded for this time slot' }, { status: 400 })
    }

    async function createOnce() {
      return await prisma.reservation.create({
        data: {
          userId,
          courtId,
          date: dayStart,
          startMin,
          endMin,
          partySize,
          playerNames: cleaned, // save normalized names
        } as any,
      })
    }
    let created
    try {
      created = await createOnce()
    } catch (err: any) {
      // Handle unique constraint violation (duplicate slot)
      if (err?.code === 'P2002') {
        return NextResponse.json({ error: 'この時間枠は既に予約されています。別の時間をご選択ください。' }, { status: 400 })
      }
      // One-time retry in case of transient pgBouncer/prepared statement issues
      await new Promise((r) => setTimeout(r, 50))
      try {
        created = await createOnce()
      } catch (err2: any) {
        if (err2?.code === 'P2002') {
          return NextResponse.json({ error: 'この時間枠は既に予約されています。別の時間をご選択ください。' }, { status: 400 })
        }
        throw err2
      }
    }

    // Store idempotent response for a short time
    if (idemKey) {
      idemStore.set(idemKey, { body: created, status: 200, ts: Date.now() })
    }
    return NextResponse.json(created)
  } catch (e: any) {
    captureError(e)
    return NextResponse.json({ error: e.message ?? 'Error' }, { status: 400 })
  }
}
