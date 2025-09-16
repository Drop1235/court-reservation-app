export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { DEFAULT_END_MIN, DEFAULT_SLOT_MINUTES, DEFAULT_START_MIN, isFiveMinuteAligned } from '@/src/lib/time'
import crypto from 'crypto'

function toUtcDateOnly(dateStr: string) {
  return new Date(dateStr + 'T00:00:00.000Z')
}

// Helper: get the most recently updated CourtSetting as the active-day config
async function getActiveDayConfig() {
  try {
    const cfg = await prisma.courtSetting.findFirst({ orderBy: { updatedAt: 'desc' } })
    return cfg
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  try {
    const cfg = await getActiveDayConfig()
    const payload = JSON.stringify(cfg)
    const etag = 'W/"' + crypto.createHash('sha1').update(payload).digest('hex') + '"'
    const inm = req.headers.get('if-none-match')
    if (inm && inm === etag) {
      const res304 = new NextResponse(null, { status: 304 })
      res304.headers.set('ETag', etag)
      res304.headers.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600')
      return res304
    }
    const res = new NextResponse(payload, { headers: { 'Content-Type': 'application/json' } })
    res.headers.set('ETag', etag)
    res.headers.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600')
    return res
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to fetch day config' }, { status: 400 })
  }
}

export async function PUT(req: Request) {
  const pin = req.headers.get('x-admin-pin') || ''
  const expected = process.env.ADMIN_PIN || ''
  if (!expected || pin !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()
    const { date, courtCount, courtNames, startMin, endMin, slotMinutes } = body || {}
    if (!date || !courtCount || !Array.isArray(courtNames)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }
    if (courtCount < 1 || courtCount > 8) {
      return NextResponse.json({ error: 'courtCount must be 1..8' }, { status: 400 })
    }
    if (courtNames.length !== courtCount) {
      return NextResponse.json({ error: 'courtNames length must equal courtCount' }, { status: 400 })
    }
    const sMin = typeof startMin === 'number' ? startMin : DEFAULT_START_MIN
    const eMin = typeof endMin === 'number' ? endMin : DEFAULT_END_MIN
    const slot = typeof slotMinutes === 'number' ? slotMinutes : DEFAULT_SLOT_MINUTES
    if (!isFiveMinuteAligned(sMin) || !isFiveMinuteAligned(eMin) || !isFiveMinuteAligned(slot)) {
      return NextResponse.json({ error: 'Times must be aligned to 5 minutes' }, { status: 400 })
    }
    if (sMin >= eMin) return NextResponse.json({ error: 'startMin must be before endMin' }, { status: 400 })
    if (slot < 5 || slot > 240) return NextResponse.json({ error: 'slotMinutes must be 5..240' }, { status: 400 })
    if ((eMin - sMin) % slot !== 0) return NextResponse.json({ error: 'Range must be divisible by slotMinutes' }, { status: 400 })

    const data = {
      date: toUtcDateOnly(date),
      courtCount,
      courtNames: courtNames.map((s: string, i: number) => (s && s.trim()) || `Court${i + 1}`),
      startMin: sMin,
      endMin: eMin,
      slotMinutes: slot,
    }

    const saved = await prisma.courtSetting.upsert({
      where: { date: data.date },
      update: { courtCount: data.courtCount, courtNames: data.courtNames, startMin: data.startMin, endMin: data.endMin, slotMinutes: data.slotMinutes },
      create: data,
    })

    return NextResponse.json(saved)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to update day config' }, { status: 400 })
  }
}
