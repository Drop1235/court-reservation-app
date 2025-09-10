export const runtime = 'nodejs'
import { prisma } from '@/src/lib/prisma'
import { requireUser } from '@/src/lib/auth'
import { assertServerReservationValidity, overlaps } from '@/src/lib/time'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
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
    return NextResponse.json(reservations)
  }

  // If no date provided: return all reservations publicly (no auth)
  const reservations = await prisma.reservation.findMany({})
  return NextResponse.json(reservations)
}

export async function POST(req: Request) {
  try {
    // Try to use the logged-in user; if not logged in, fall back to a default seeded user
    let userId: string
    try {
      const user = await requireUser()
      userId = user.id
    } catch {
      const guest = await prisma.user.upsert({
        where: { email: 'user@example.com' },
        create: { email: 'user@example.com' },
        update: {},
      })
      userId = guest.id
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
    const cleaned = playerNames.map((n) => (typeof n === 'string' ? n.trim() : '')).filter(Boolean)
    if (cleaned.length !== partySize) {
      return NextResponse.json({ error: '人数分の氏名を入力してください' }, { status: 400 })
    }
    assertServerReservationValidity(startMin, endMin, partySize)

    const dayStart = new Date(date + 'T00:00:00.000Z')

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

    const created = await prisma.reservation.create({
      data: {
        userId,
        courtId,
        date: dayStart,
        startMin,
        endMin,
        partySize,
        playerNames: cleaned,
      },
    })

    return NextResponse.json(created)
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Error' }, { status: 400 })
  }
}
