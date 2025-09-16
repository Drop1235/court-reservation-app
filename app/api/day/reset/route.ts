export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'

// Find the currently active day (most recently updated CourtSetting)
async function getActiveDayConfig() {
  try {
    const cfg = await prisma.courtSetting.findFirst({ orderBy: { updatedAt: 'desc' } })
    return cfg
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const pin = req.headers.get('x-admin-pin') || ''
  const expected = process.env.ADMIN_PIN || ''
  if (!expected || pin !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const cfg = await getActiveDayConfig()
    if (!cfg) return NextResponse.json({ ok: true, deleted: 0 })

    const dayStart = cfg.date
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1)

    const result = await prisma.reservation.deleteMany({
      where: { date: { gte: dayStart, lte: dayEnd } },
    })

    // Touch the CourtSetting to bump updatedAt so ETag on clients naturally changes
    await prisma.courtSetting.update({ where: { id: cfg.id }, data: { updatedAt: new Date() } as any })

    return NextResponse.json({ ok: true, deleted: result.count })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to reset day' }, { status: 400 })
  }
}
