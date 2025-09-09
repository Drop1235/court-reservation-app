import { prisma } from '@/src/lib/prisma'
import { requireUser } from '@/src/lib/auth'
import { NextResponse } from 'next/server'

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser()
    const res = await prisma.reservation.findUnique({ where: { id: params.id } })
    if (!res || res.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.reservation.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Error' }, { status: 400 })
  }
}
