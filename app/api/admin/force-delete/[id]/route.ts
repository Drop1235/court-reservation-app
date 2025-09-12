export const runtime = 'nodejs'
import { prisma } from '@/src/lib/prisma'
import { NextResponse } from 'next/server'

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const pin = _req.headers.get('x-admin-pin') || ''
    const expected = process.env.ADMIN_PIN || ''
    if (!expected || pin !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Idempotent delete: do not error if already deleted
    const result = await prisma.reservation.deleteMany({ where: { id: params.id } })
    if (result.count > 0) {
      await prisma.auditLog.create({ data: { action: 'force_delete', actorEmail: 'public', meta: { reservationId: params.id } } })
    }
    return NextResponse.json({ ok: true, deleted: result.count })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Error' }, { status: 400 })
  }
}
