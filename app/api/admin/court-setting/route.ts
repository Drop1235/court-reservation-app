export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { DEFAULT_END_MIN, DEFAULT_SLOT_MINUTES, DEFAULT_START_MIN, isFiveMinuteAligned } from '@/src/lib/time'
import { getExpectedAdminPin } from '@/src/lib/admin'

function toUtcDateOnly(dateStr: string) {
  // Expecting YYYY-MM-DD
  return new Date(dateStr + 'T00:00:00.000Z')
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'date is required (YYYY-MM-DD)' }, { status: 400 })
  try {
    const item = await prisma.courtSetting.findUnique({ where: { date: toUtcDateOnly(date) } })
    return NextResponse.json(item)
  } catch (e: any) {
    // If table not found (migration not yet applied), return null gracefully
    return NextResponse.json(null)
  }
}

export async function POST(req: Request) {
  const pin = req.headers.get('x-admin-pin') || ''
  const expected = await getExpectedAdminPin()
  if (!expected || pin !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { date, courtCount, courtNames, startMin, endMin, slotMinutes } = body || {}
  if (!date || !courtCount || !Array.isArray(courtNames)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  if (courtCount < 1 || courtCount > 21) {
    return NextResponse.json({ error: 'courtCount must be 1..21' }, { status: 400 })
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
}
