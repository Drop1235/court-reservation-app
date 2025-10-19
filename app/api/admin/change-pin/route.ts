export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getExpectedAdminPin, setAdminPin } from '@/src/lib/admin'

export async function POST(req: Request) {
  try {
    const current = req.headers.get('x-admin-pin') || ''
    const expected = await getExpectedAdminPin()
    if (!expected || current !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await req.json().catch(() => ({})) as { newPin?: string }
    const newPin = (body?.newPin || '').trim()
    if (!newPin) return NextResponse.json({ error: 'newPin is required' }, { status: 400 })
    if (!/^\S{4,}$/.test(newPin)) {
      return NextResponse.json({ error: 'newPin must be at least 4 non-space characters' }, { status: 400 })
    }
    const ok = await setAdminPin(newPin)
    if (!ok) return NextResponse.json({ error: 'Failed to persist new PIN (migration not applied?)' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to change PIN' }, { status: 400 })
  }
}
