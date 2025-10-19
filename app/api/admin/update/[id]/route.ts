export const runtime = 'nodejs'
import { prisma } from '@/src/lib/prisma'
import { NextResponse } from 'next/server'
import { normalizeNames } from '@/src/lib/text'
import { getExpectedAdminPin } from '@/src/lib/admin'

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const pin = req.headers.get('x-admin-pin') || ''
    const expected = await getExpectedAdminPin()
    if (!expected || pin !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    let playerNames: unknown = body?.playerNames
    if (!Array.isArray(playerNames)) {
      return NextResponse.json({ error: 'playerNames must be an array of strings' }, { status: 400 })
    }

    // 受け取った名前をトリム・空白除去し、正規化
    const cleaned = normalizeNames(
      (playerNames as string[]).map((n) => (typeof n === 'string' ? n.replace(/\s+/g, '') : ''))
    )

    // 予約レコードを更新（人数や時間・コートは変更しない）
    const updated = await prisma.reservation.update({
      where: { id: params.id },
      data: { playerNames: cleaned as any },
    })

    // 監査ログ
    try { await prisma.auditLog.create({ data: { action: 'admin_update_names', actorEmail: 'admin', meta: { reservationId: params.id } } }) } catch {}

    const res = NextResponse.json(updated)
    // キャッシュ無効化ヘッダー
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')
    return res
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Error' }, { status: 400 })
  }
}
