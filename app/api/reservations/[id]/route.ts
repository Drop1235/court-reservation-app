import { prisma } from '@/src/lib/prisma'
import { NextResponse } from 'next/server'

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const res = await prisma.reservation.findUnique({ where: { id: params.id } })
    if (!res) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Normalize helper: full-width to half-width digits and strip non-digits
    const normalizePin = (v: any) =>
      String(v ?? '')
        .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30))
        .replace(/[^0-9]/g, '')

    const stored = normalizePin((res as any).pin as string | undefined)
    if (!stored) {
      return NextResponse.json({ error: 'この予約はPINでの取消に対応していません。' }, { status: 400 })
    }
    let pin: string | undefined
    try {
      const body: any = await req.json()
      pin = typeof body?.pin === 'string' ? body.pin : undefined
    } catch {}
    const norm = normalizePin(pin)
    if (!/^\d{4}$/.test(norm)) {
      return NextResponse.json({ error: '暗証番号（4桁の数字）を入力してください。' }, { status: 400 })
    }
    if (norm !== stored) {
      return NextResponse.json({ error: '暗証番号が違います。' }, { status: 401 })
    }

    await prisma.reservation.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Error' }, { status: 400 })
  }
}
