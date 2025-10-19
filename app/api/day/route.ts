export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { getExpectedAdminPin } from '@/src/lib/admin'
import { DEFAULT_END_MIN, DEFAULT_SLOT_MINUTES, DEFAULT_START_MIN, isFiveMinuteAligned } from '@/src/lib/time'
import crypto from 'crypto'

function toUtcDateOnly(dateStr: string) {
  return new Date(dateStr + 'T00:00:00.000Z')
}

// Helper: get the most recently updated CourtSetting as the active-day config
async function getActiveDayConfig() {
  try {
    const cfg = await prisma.courtSetting.findFirst({ orderBy: { updatedAt: 'desc' } })
    return cfg
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  try {
    const cfg = await getActiveDayConfig()
    // Normalize for length/empties only; allow arbitrary characters the admin entered
    const safe = (() => {
      if (!cfg) return cfg
      const count = Math.max(1, Math.min(21, cfg.courtCount || 1))
      const names = Array.from({ length: count }, (_, i) => {
        const raw = (cfg.courtNames?.[i] ?? '').toString().trim()
        const fallback = String.fromCharCode(65 + i)
        return raw || fallback
      })
      return { ...cfg, courtCount: count, courtNames: names, preparing: !!(cfg as any).preparing }
    })()
    // Also include blackout blocks for the same date
    let blocks: any[] = []
    try {
      const anyPrisma: any = prisma as any
      const hasCourtBlock = anyPrisma && anyPrisma.courtBlock && typeof anyPrisma.courtBlock.findMany === 'function'
      if (hasCourtBlock && safe?.date) {
        blocks = await anyPrisma.courtBlock.findMany({ where: { date: (safe as any).date }, orderBy: { startMin: 'asc' } })
      }
    } catch {}
    const payload = JSON.stringify(safe ? { ...safe, blocks } : safe)
    const etag = 'W/"' + crypto.createHash('sha1').update(payload).digest('hex') + '"'
    const inm = req.headers.get('if-none-match')
    if (inm && inm === etag) {
      const res304 = new NextResponse(null, { status: 304 })
      res304.headers.set('ETag', etag)
      // Avoid any stale reuse by CDN/browser
      res304.headers.set('Cache-Control', 'no-store')
      return res304
    }
    const res = new NextResponse(payload, { headers: { 'Content-Type': 'application/json' } })
    res.headers.set('ETag', etag)
    // Avoid any stale reuse by CDN/browser
    res.headers.set('Cache-Control', 'no-store')
    return res
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to fetch day config' }, { status: 400 })
  }
}

export async function PUT(req: Request) {
  const pin = req.headers.get('x-admin-pin') || ''
  const expected = await getExpectedAdminPin()
  if (!expected || pin !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()
    const { date, courtCount, courtNames, startMin, endMin, slotMinutes, preparing, notice, blocks } = body || {}
    if (!date || !courtCount || !Array.isArray(courtNames)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }
    if (courtCount < 1 || courtCount > 21) {
      return NextResponse.json({ error: 'courtCount must be 1..21' }, { status: 400 })
    }
    if (courtNames.length !== courtCount) {
      return NextResponse.json({ error: 'courtNames length must equal courtCount' }, { status: 400 })
    }
    const sMin = typeof startMin === 'number' ? startMin : DEFAULT_START_MIN
    const eMin = typeof endMin === 'number' ? endMin : DEFAULT_END_MIN
    const slot = typeof slotMinutes === 'number' ? slotMinutes : DEFAULT_SLOT_MINUTES
    if (!isFiveMinuteAligned(sMin) || !isFiveMinuteAligned(eMin) || !isFiveMinuteAligned(slot)) {
      return NextResponse.json({ error: 'Times must be aligned to 5 minutes' }, { status: 400 })
    }
    if (sMin >= eMin) return NextResponse.json({ error: 'startMin must be before endMin' }, { status: 400 })
    if (slot < 5 || slot > 240) return NextResponse.json({ error: 'slotMinutes must be 5..240' }, { status: 400 })
    if ((eMin - sMin) % slot !== 0) return NextResponse.json({ error: 'Range must be divisible by slotMinutes' }, { status: 400 })

    const normalizedNames: string[] = Array.from({ length: courtCount }, (_, i) => {
      const raw = (courtNames[i] ?? '').toString().trim()
      const fallback = String.fromCharCode(65 + i) // A..U
      return raw || fallback
    })

    const data = {
      date: toUtcDateOnly(date),
      courtCount,
      courtNames: normalizedNames,
      startMin: sMin,
      endMin: eMin,
      slotMinutes: slot,
      preparing: typeof preparing === 'boolean' ? preparing : undefined,
      notice: typeof notice === 'string' ? notice : undefined,
    }

    // Avoid relying on unique(date) in environments where schema may lag
    const existing = await prisma.courtSetting.findFirst({ where: { date: data.date } })
    let saved
    if (existing) {
      saved = await prisma.courtSetting.update({
        where: { id: existing.id },
        data: ({
          courtCount: data.courtCount,
          courtNames: data.courtNames,
          startMin: data.startMin,
          endMin: data.endMin,
          slotMinutes: data.slotMinutes,
          ...(typeof data.preparing === 'boolean' ? { preparing: data.preparing } : {}),
          ...(typeof data.notice === 'string' ? { notice: data.notice } : {}),
        } as any),
      })
    } else {
      saved = await prisma.courtSetting.create({
        data: ({
          date: data.date,
          courtCount: data.courtCount,
          courtNames: data.courtNames,
          startMin: data.startMin,
          endMin: data.endMin,
          slotMinutes: data.slotMinutes,
          preparing: typeof data.preparing === 'boolean' ? data.preparing : false,
          notice: typeof data.notice === 'string' ? data.notice : null,
        } as any),
      })
    }

    // Replace blackout blocks for this date if provided
    if (Array.isArray(blocks)) {
      // Validate blocks
      const valid = [] as { courtId: number; startMin: number; endMin: number; reason?: string }[]
      for (const b of blocks) {
        const c = Number(b?.courtId)
        const s = Number(b?.startMin)
        const e = Number(b?.endMin)
        if (!Number.isInteger(c) || c < 1 || c > courtCount) continue
        if (!Number.isInteger(s) || !Number.isInteger(e)) continue
        if (!isFiveMinuteAligned(s) || !isFiveMinuteAligned(e)) continue
        if (s >= e) continue
        if (s < sMin || e > eMin) continue
        valid.push({ courtId: c, startMin: s, endMin: e, reason: typeof b?.reason === 'string' ? b.reason : undefined })
      }
      try {
        const anyPrisma: any = prisma as any
        const hasCourtBlock = anyPrisma && anyPrisma.courtBlock && typeof anyPrisma.courtBlock.deleteMany === 'function' && typeof anyPrisma.courtBlock.createMany === 'function'
        if (hasCourtBlock) {
          await prisma.$transaction([
            anyPrisma.courtBlock.deleteMany({ where: { date: data.date } }),
            ...(valid.length > 0 ? [anyPrisma.courtBlock.createMany({ data: valid.map(v => ({ ...v, date: data.date })) })] : []),
          ])
        }
      } catch {}
    }

    // Return merged config with latest blocks
    try {
      const anyPrisma: any = prisma as any
      const hasCourtBlock = anyPrisma && anyPrisma.courtBlock && typeof anyPrisma.courtBlock.findMany === 'function'
      const latestBlocks = hasCourtBlock
        ? await anyPrisma.courtBlock.findMany({ where: { date: data.date }, orderBy: { startMin: 'asc' } })
        : []
      return NextResponse.json({ ...saved, blocks: latestBlocks })
    } catch {
      return NextResponse.json(saved)
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to update day config' }, { status: 400 })
  }
}
