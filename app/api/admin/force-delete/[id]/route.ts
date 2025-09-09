import { prisma } from '@/src/lib/prisma'
import { NextResponse } from 'next/server'

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const pin = req.headers.get('x-admin-pin') || ''
    const expected = process.env.ADMIN_PIN || ''
    if (!expected || pin !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    await prisma.reservation.delete({ where: { id: params.id } })
    await prisma.auditLog.create({ data: { action: 'force_delete', actorEmail: 'public', meta: { reservationId: params.id } } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Error' }, { status: 400 })
  }
}
