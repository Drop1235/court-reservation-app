export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'

export async function POST(req: Request) {
  const pin = req.headers.get('x-admin-pin') || ''
  const expected = process.env.ADMIN_PIN || ''
  if (!expected || pin !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { before, all } = await req.json().catch(() => ({ before: undefined, all: undefined }))
    if (all === true) {
      const deleted = await prisma.reservation.deleteMany({})
      return NextResponse.json({ deleted: deleted.count, mode: 'all' })
    }
    const now = new Date()
    const cutoff = before ? new Date(before) : now
    const deleted = await prisma.reservation.deleteMany({ where: { date: { lt: cutoff } } })
    return NextResponse.json({ deleted: deleted.count, before: cutoff.toISOString(), mode: 'before' })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to delete past reservations' }, { status: 400 })
  }
}
