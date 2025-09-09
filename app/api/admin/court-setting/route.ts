import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'

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
  const expected = process.env.ADMIN_PIN || ''
  if (!expected || pin !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { date, courtCount, courtNames } = body || {}
  if (!date || !courtCount || !Array.isArray(courtNames)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  if (courtCount < 1 || courtCount > 8) {
    return NextResponse.json({ error: 'courtCount must be 1..8' }, { status: 400 })
  }
  if (courtNames.length !== courtCount) {
    return NextResponse.json({ error: 'courtNames length must equal courtCount' }, { status: 400 })
  }

  const data = {
    date: toUtcDateOnly(date),
    courtCount,
    courtNames: courtNames.map((s: string, i: number) => (s && s.trim()) || `Court${i + 1}`),
  }

  const saved = await prisma.courtSetting.upsert({
    where: { date: data.date },
    update: { courtCount: data.courtCount, courtNames: data.courtNames },
    create: data,
  })

  return NextResponse.json(saved)
}
