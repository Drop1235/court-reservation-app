export const runtime = 'nodejs'
import { prisma } from '@/src/lib/prisma'
import { requireUser } from '@/src/lib/auth'
import { assertServerReservationValidity, overlaps } from '@/src/lib/time'
import { normalizeNames } from '@/src/lib/text'
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { rateLimitOnce } from '@/src/lib/rate-limit'
import { captureError, captureErrorWithRequest } from '@/src/lib/sentry'

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
    const path = new URL(req.url).pathname || ''
    const combo = [ip && `ip:${ip}`, ua && `ua:${ua}`, path && `p:${path}`].filter(Boolean).join('|')
    return combo || 'unknown'
  } catch {
    return 'unknown'
  }
}

async function buildRateKey(req: Request, idemKey: string | null): Promise<string> {
  // Prefer userId when available; fallback to IP+UA+path
  let base: string
  try {
    const user = await requireUser()
    if (user?.id) base = `user:${user.id}`
    else base = clientKey(req)
  } catch {
    base = clientKey(req)
  }
  return idemKey ? `post:${base}:${idemKey}` : `post:${base}`
}

// Shared idempotency storage backed by Netlify Blobs with in-memory fallback
const idemStoreMem = new Map<string, { body: any; status: number; ts: number }>()
const IDEM_TTL_MS = 10 * 60 * 1000 // 10 minutes
function getIdemKey(req: Request): string | null {
  const k = req.headers.get('idempotency-key') || req.headers.get('x-idempotency-key')
  return k ? k.trim() : null
}
function sweepIdem() {
  const now = Date.now()
  for (const [k, v] of idemStoreMem.entries()) {
    if (now - v.ts > IDEM_TTL_MS) idemStoreMem.delete(k)
  }
}

async function idemRead(key: string): Promise<{ body: any; status: number; ts: number } | null> {
  // Try Netlify Blobs first
  try {
    // @ts-ignore dynamic import to avoid local dev dependency
    const mod: any = await import('@netlify/blobs')
    const getStore: ((name: string) => any) | undefined = (mod && (mod.getStore || (mod as any).blobs?.getStore)) as any
    if (getStore) {
      const store = getStore('idem')
      const raw = await store.get(key)
      if (raw) {
        try { return JSON.parse(raw as string) } catch {}
      }
    }
  } catch {}
  // Fallback to memory map
  const v = idemStoreMem.get(key)
  if (!v) return null
  if (Date.now() - v.ts > IDEM_TTL_MS) {
    idemStoreMem.delete(key)
    return null
  }
  return v
}

async function idemWrite(key: string, value: { body: any; status: number; ts: number }): Promise<void> {
  // Try Netlify Blobs with TTL
  try {
    // @ts-ignore dynamic import
    const mod: any = await import('@netlify/blobs')
    const getStore: ((name: string) => any) | undefined = (mod && (mod.getStore || (mod as any).blobs?.getStore)) as any
    if (getStore) {
      const store = getStore('idem')
      const ttlSeconds = Math.max(1, Math.ceil(IDEM_TTL_MS / 1000))
      await store.set(key, JSON.stringify(value), { ttl: ttlSeconds })
    }
  } catch {}
  // Always set memory fallback
  idemStoreMem.set(key, value)
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date') // yyyy-mm-dd
    const courtId = searchParams.get('courtId')


    // If date provided: filter by day (and optional court)
    if (date) {
      const startOfDay = new Date(date + 'T00:00:00.000Z')
      const endOfDay = new Date(date + 'T23:59:59.999Z')
      const where: any = { date: { gte: startOfDay, lte: endOfDay } }
      if (courtId) where.courtId = Number(courtId)
      const reservations = await prisma.reservation.findMany({ where })
      const payload = JSON.stringify(reservations)
      const res = new NextResponse(payload, { headers: { 'Content-Type': 'application/json' } })
      // Strictly disable caching everywhere to avoid ghost re-appearing rows after delete
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
      res.headers.set('Pragma', 'no-cache')
      res.headers.set('Expires', '0')
      return res
    }

    // If no date provided: return all reservations publicly (no auth)
    const reservations = await prisma.reservation.findMany({})
    const payload = JSON.stringify(reservations)
    const res = new NextResponse(payload, { headers: { 'Content-Type': 'application/json' } })
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')
    return res
  } catch (e: any) {
    captureErrorWithRequest(req, e)
    return NextResponse.json({ error: e?.message ?? 'Failed to fetch reservations' }, { status: 400 })
  }
}

export async function POST(req: Request) {
  try {
    // Idempotency-Key handling (best-effort per instance) — check BEFORE rate limiting
    // So that a duplicate submission with the same key returns cached 200 even within the window
    sweepIdem()
    const idemKey = getIdemKey(req)
    if (idemKey) {
      const cached = await idemRead(idemKey)
      if (cached) {
        return NextResponse.json(cached.body, { status: cached.status })
      }
    }

    // Best-effort IP-based rate limiting to reduce bursts.
    // If an Idempotency-Key is present, scope the limiter to that key so that
    // a brand-new idempotent submission is not blocked by a previous attempt.
    const rateKey = await buildRateKey(req, idemKey)
    if (await rateLimitOnce(rateKey, RL_WINDOW_MS)) {
      const res429 = NextResponse.json(
        { error: 'リクエストが多すぎます。数秒後に再度お試しください。' },
        { status: 429 },
      )
      // Debug headers only in non-production
      if (process.env.NODE_ENV !== 'production') {
        if (idemKey) res429.headers.set('X-Idem-Key', idemKey)
        res429.headers.set('X-Rate-Key', rateKey)
        res429.headers.set('X-Rate-WindowMs', String(RL_WINDOW_MS))
      }
      return res429
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
    // Rule: コーチは選手1名に対して1名まで
    {
      const coachCount = cleaned.filter((n) => n === 'コーチ').length
      const playerCount = cleaned.length - coachCount
      if (coachCount > playerCount) {
        return NextResponse.json({ error: 'コーチは選手1名につき1名までです。氏名の入力を見直してください。' }, { status: 400 })
      }
    }
    assertServerReservationValidity(startMin, endMin, partySize)

    const dayStart = new Date(date + 'T00:00:00.000Z')

    // Ensure the referenced Court exists with a stable id matching the selected index.
    // This guards against production DBs where courts were not fully seeded (causing FK errors).
    const ensuredCourt = await prisma.court.upsert({
      where: { id: courtId },
      create: { id: courtId, name: `Court${courtId}` },
      update: {},
    })
    const dbCourtId = ensuredCourt.id

    // Rule: お一人様1枠まで（終了後は再予約可）。
    // - 同じ日付で、同一人物（コーチ以外）が「まだ終了していない」予約を持っている場合はブロック
    // - それ以外にも、時間帯が重なる場合は常にブロック
    try {
      const dayStartStart = new Date(dayStart)
      const dayStartEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000 - 1)

      const now = new Date()
      // Local-day comparison aligned with UI's displayed date
      const pad = (n: number) => String(n).padStart(2, '0')
      const localTodayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const nowMinLocal = now.getHours() * 60 + now.getMinutes()

      const existingSameDay = await prisma.reservation.findMany({
        where: { date: { gte: dayStartStart, lte: dayStartEnd } },
      })

      // Compare using normalized names; ignore 'コーチ'
      const cleanedSet = new Set(cleaned.filter((n) => n !== 'コーチ'))
      const relevant = existingSameDay.filter((r) => {
        const names = (r as any).playerNames as string[] | undefined
        const norm = normalizeNames(Array.isArray(names) ? names : [])
        return norm.some((n) => n !== 'コーチ' && cleanedSet.has(n))
      })

      let conflict = false
      const isToday = date === localTodayStr
      if (isToday) {
        const hasFutureExisting = relevant.some((r) => r.endMin > nowMinLocal)
        const isNewFuture = startMin >= nowMinLocal
        if (hasFutureExisting && isNewFuture) conflict = true
      } else {
        // 今日以外: ブロック制約は不要（毎日手動リセット運用）。
        conflict = false
      }

      // いつでも、時間帯が重なる場合はブロック
      if (!conflict) {
        conflict = relevant.some((r) => overlaps(r.startMin, r.endMin, startMin, endMin))
      }

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
      where: { courtId: dbCourtId, date: { gte: dayStart, lte: new Date(dayStart.getTime() + 24 * 3600 * 1000 - 1) } },
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
          courtId: dbCourtId,
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
      await idemWrite(idemKey, { body: created, status: 200, ts: Date.now() })
    }
    return NextResponse.json(created)
  } catch (e: any) {
    captureErrorWithRequest(req, e)
    return NextResponse.json({ error: e.message ?? 'Error' }, { status: 400 })
  }
}
