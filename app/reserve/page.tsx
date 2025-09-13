"use client"
import { useEffect, useMemo, useState, Fragment, useRef } from 'react'
import { makeSlots, DEFAULT_END_MIN, DEFAULT_SLOT_MINUTES, DEFAULT_START_MIN } from '@/src/lib/time'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { halfHourSlots9to21 } from '@/src/lib/time'
import { format } from 'date-fns'

const DEFAULT_COURT_COUNT = 4
const MAX_COURTS = 8

export default function ReservePage() {
  const qc = useQueryClient()
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [selectedCourt, setSelectedCourt] = useState<number>(1)
  const [partySize, setPartySize] = useState(1)
  const [playerNames, setPlayerNames] = useState<string[]>([''])
  const [courtCount, setCourtCount] = useState<number>(DEFAULT_COURT_COUNT)
  const [courtNames, setCourtNames] = useState<string[]>(Array.from({ length: DEFAULT_COURT_COUNT }, (_, i) => `Court${i + 1}`))
  const [startMin, setStartMin] = useState<number>(DEFAULT_START_MIN)
  const [endMin, setEndMin] = useState<number>(DEFAULT_END_MIN)
  const [slotMinutes, setSlotMinutes] = useState<number>(DEFAULT_SLOT_MINUTES)

  // client-only render guard to avoid hydration mismatch
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Load court settings per date (read-only)
  useEffect(() => {
    ;(async () => {
      try {
        const res = await axios.get('/api/admin/court-setting', { params: { date } })
        const data = res.data
        if (data && typeof data.courtCount === 'number' && Array.isArray(data.courtNames)) {
          const cnt = Math.min(Math.max(data.courtCount, 1), MAX_COURTS)
          setCourtCount(cnt)
          const names = data.courtNames.slice(0, cnt)
          setCourtNames(names.length === cnt ? names : Array.from({ length: cnt }, (_, i) => names[i] || `Court${i + 1}`))
          if (typeof data.startMin === 'number') setStartMin(data.startMin)
          else setStartMin(DEFAULT_START_MIN)
          if (typeof data.endMin === 'number') setEndMin(data.endMin)
          else setEndMin(DEFAULT_END_MIN)
          if (typeof data.slotMinutes === 'number') setSlotMinutes(data.slotMinutes)
          else setSlotMinutes(DEFAULT_SLOT_MINUTES)
        } else {
          setCourtCount(DEFAULT_COURT_COUNT)
          setCourtNames(Array.from({ length: DEFAULT_COURT_COUNT }, (_, i) => `Court${i + 1}`))
          setStartMin(DEFAULT_START_MIN)
          setEndMin(DEFAULT_END_MIN)
          setSlotMinutes(DEFAULT_SLOT_MINUTES)
        }
      } catch {
        setCourtCount(DEFAULT_COURT_COUNT)
        setCourtNames(Array.from({ length: DEFAULT_COURT_COUNT }, (_, i) => `Court${i + 1}`))
        setStartMin(DEFAULT_START_MIN)
        setEndMin(DEFAULT_END_MIN)
        setSlotMinutes(DEFAULT_SLOT_MINUTES)
      }
    })()
  }, [date])

  // keep selectedCourt in range
  useEffect(() => {
    setSelectedCourt((c) => (c > courtCount ? 1 : c))
  }, [courtCount])

  // removed: localStorage editors (now admin-only)

  const slots = useMemo(() => makeSlots(startMin, endMin, slotMinutes), [startMin, endMin, slotMinutes])

  const etagRef = useRef<string | null>(null)
  // Keep optimistic temps visible even if a background refetch returns without the new row yet
  const tempsRef = useRef<any[]>([])
  const { data: reservations } = useQuery({
    queryKey: ['reservations', date],
    // Add no-cache header so browser/CDN revalidates immediately after a mutation
    queryFn: async () => {
      const headers: Record<string,string> = { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      if (etagRef.current) headers['If-None-Match'] = etagRef.current
      const res = await axios.get(`/api/reservations?date=${date}`, { headers })
      const etag = res.headers['etag'] || res.headers['ETag']
      if (etag) etagRef.current = etag as string
      // Merge server data with any optimistic temps (avoid duplicates by id)
      const base = Array.isArray(res.data) ? res.data.slice() : []
      for (const t of tempsRef.current) {
        if (!base.some((r: any) => r.id === t.id)) base.push(t)
      }
      return base
    },
    refetchOnWindowFocus: true,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    staleTime: 30_000,
  })

  const usedCapacity = (start: number, end: number, courtId: number) => {
    return (
      reservations
        ?.filter((r: any) => r.courtId === courtId && Math.max(r.startMin, start) < Math.min(r.endMin, end))
        .reduce((acc: number, r: any) => acc + r.partySize, 0) ?? 0
    )
  }

  const createMutation = useMutation({
    mutationFn: async (args: { payload: any; idemKey: string }) => (
      await axios.post('/api/reservations', args.payload, { headers: { 'Idempotency-Key': args.idemKey } })
    ).data,
    onMutate: async (args: { payload: any; idemKey: string }) => {
      await qc.cancelQueries({ queryKey: ['reservations', date] })
      const previous = qc.getQueryData(['reservations', date]) as any[] | undefined
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const temp = {
        id: tempId,
        courtId: args.payload.courtId,
        date: new Date(date + 'T00:00:00.000Z'),
        startMin: args.payload.startMin,
        endMin: args.payload.endMin,
        partySize: args.payload.partySize,
        playerNames: args.payload.playerNames,
        __temp: true,
      }
      tempsRef.current = [...tempsRef.current.filter((x) => x.id !== tempId), temp]
      qc.setQueryData(['reservations', date], (prev: any) => {
        const list = Array.isArray(prev) ? prev.slice() : []
        list.push(temp)
        return list
      })
      return { previous, tempId }
    },
    onError: (err: any, _vars, ctx) => {
      if (ctx?.tempId) tempsRef.current = tempsRef.current.filter((x) => x.id !== ctx.tempId)
      if (ctx?.previous) qc.setQueryData(['reservations', date], ctx.previous)
      const msg = err?.response?.data?.error
        || err?.message
        || '予約に失敗しました。他の方の予約と競合した可能性があります。時間や人数を変更して再度お試しください。'
      alert(msg)
    },
    onSuccess: async (created: any, _vars, ctx) => {
      // Replace temp with server result (or append if temp not found)
      qc.setQueryData(['reservations', date], (prev: any) => {
        const list = Array.isArray(prev) ? prev.slice() : []
        const idx = list.findIndex((r: any) => r.id === ctx?.tempId)
        if (idx >= 0) list[idx] = created
        else list.push(created)
        return list
      })
      if (ctx?.tempId) tempsRef.current = tempsRef.current.filter((x) => x.id !== ctx.tempId)
      // Also trigger a background refetch to reconcile with server state
      etagRef.current = null // force next poll to fetch fresh
      // Guarantee network gets the newest snapshot (bypass CDN/browser cache once)
      try {
        const resNow = await axios.get(`/api/reservations?date=${date}&_=${Date.now()}`,
          { headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' } })
        // Merge temps into the fresh payload just in case success of other mutation is still pending
        const fresh = Array.isArray(resNow.data) ? resNow.data.slice() : []
        for (const t of tempsRef.current) {
          if (!fresh.some((r: any) => r.id === t.id)) fresh.push(t)
        }
        qc.setQueryData(['reservations', date], fresh)
      } catch {
        // ignore; periodic refetch will still sync
      }
      // Additionally let react-query do a standard refetch for consistency
      await qc.refetchQueries({ queryKey: ['reservations', date] })
    },
  })

  const [selectedSlot, setSelectedSlot] = useState<{ start: number; end: number } | null>(null)

  // Changing date should reset the selection; changing court should not (to allow opening dialog from a cell)
  useEffect(() => setSelectedSlot(null), [date])
  // When opening modal or data changes, clamp partySize to remaining capacity
  useEffect(() => {
    if (!selectedSlot) return
    const used = usedCapacity(selectedSlot.start, selectedSlot.end, selectedCourt)
    const maxAllowed = Math.max(1, 4 - used)
    setPartySize((p) => Math.min(p, maxAllowed))
  }, [selectedSlot, selectedCourt, reservations])
  // ensure playerNames length equals partySize
  useEffect(() => {
    setPlayerNames((prev) => {
      const next = [...prev]
      if (partySize > next.length) {
        while (next.length < partySize) next.push('')
      } else if (partySize < next.length) {
        next.length = partySize
      }
      return next
    })
  }, [partySize])

  // Helper: names booked for a given slot
  const namesForSlot = (start: number, end: number, courtId: number) => {
    return (
      reservations
        ?.filter((r: any) => r.courtId === courtId && Math.max(r.startMin, start) < Math.min(r.endMin, end))
        .flatMap((r: any) => (Array.isArray(r.playerNames) ? r.playerNames : [])) ?? []
    )
  }

  const fmt = (min: number) => {
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  if (!mounted) return null

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="mb-2 font-bold">【重要】予約に関するお願い</p>
        <p className="mb-1">予約はお一人様1枠までとなります。</p>
        <p className="mb-1">ただし、練習を終えた後であれば新たに予約を入れていただけます。</p>
        <p className="mb-1">複数枠の同時予約は禁止です。2枠以上の予約が確認された場合は、管理側で削除いたします。</p>
        <p className="mb-1">大会に参加する選手の方は <span className="font-bold">フルネーム</span> を入力してください。</p>
        <p className="mb-1">選手以外（＝練習相手）の方は <span className="font-bold">「コーチ」</span> と入力をお願いします。</p>
        <p className="mb-1">予約をキャンセルする場合は、必ず下記までお電話ください。</p>
        <p className="mt-2 font-bold">TEL：050-7118-5600</p>
      </div>
      <div>
        <h1 className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-xl font-bold text-transparent">予約</h1>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input className="rounded border px-3 py-2" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="text-xs text-gray-500">コート数：{courtCount}</div>
        </div>
      </div>

      <div className="space-y-3">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-green-100 ring-1 ring-green-300" />空きあり</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-yellow-100 ring-1 ring-yellow-300" />一部予約あり</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-gray-200 ring-1 ring-gray-300" />満枠</span>
        </div>

        {/* Matrix */}
        <div className="overflow-auto">
          <div>
            <div className="grid" style={{ gridTemplateColumns: `5.25rem repeat(${courtCount}, minmax(5rem,1fr))` }}>
              {/* Header row */}
              <div className="sticky left-0 z-10 bg-white/80 p-1 text-[10px] font-medium text-gray-600">時間</div>
              {Array.from({ length: courtCount }).map((_, i) => (
                <div key={`head-${i}`} className="p-1 text-center text-[10px] font-semibold text-gray-700">{courtNames[i] ?? `Court${i + 1}`}</div>
              ))}
              {/* Rows */}
              {slots.map((s) => (
                <Fragment key={`row-${s.start}`}>
                  <div className="sticky left-0 z-10 border-t bg-white/80 p-1 text-[11px] font-medium">
                    {fmt(s.start)} - {fmt(s.end)}
                  </div>
                  {Array.from({ length: courtCount }).map((_, idx) => {
                    const courtId = idx + 1
                    const used = usedCapacity(s.start, s.end, courtId)
                    const full = used >= 4
                    const some = used > 0 && used < 4
                    const names = namesForSlot(s.start, s.end, courtId)
                    const base = full ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : some ? 'bg-yellow-100 hover:bg-yellow-200' : 'bg-green-100 hover:bg-green-200'
                    return (
                      <button
                        key={`c-${courtId}-s-${s.start}`}
                        type="button"
                        disabled={full}
                        onClick={() => {
                          setSelectedCourt(courtId)
                          setSelectedSlot({ start: s.start, end: s.end })
                        }}
                        className={`border-t p-1.5 text-left transition-colors ${base}`}
                      >
                        <div className="text-[11px] font-medium">{used}/4</div>
                        {names.length > 0 && (
                          <div className="mt-0.5 space-y-0.5 text-[11px] leading-5 text-gray-800">
                            {names.map((n: string, i: number) => (
                              <div key={i}>{n}</div>
                            ))}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedSlot && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/30 p-4 sm:place-items-center">
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
            <div className="mb-1 text-lg font-semibold">予約 {format(new Date(date), 'yyyy-MM-dd')}</div>
            <div className="mb-3 text-sm text-gray-700">コート：{courtNames[selectedCourt-1] ?? `Court${selectedCourt}`}</div>
            <div className="mb-4 text-sm">
              {(() => {
                const used = usedCapacity(selectedSlot.start, selectedSlot.end, selectedCourt)
                const maxAllowed = Math.max(1, 4 - used)
                return (
                  <select className="rounded border px-2 py-1" value={partySize} onChange={(e) => setPartySize(Number(e.target.value))}>
                    {Array.from({ length: maxAllowed }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                )
              })()}
              <span className="ml-2 text-xs text-gray-600">（残り {Math.max(0, 4 - usedCapacity(selectedSlot.start, selectedSlot.end, selectedCourt))} 名）</span>
            </div>
            <div className="mb-2">
              <label className="mb-1 block text-sm font-medium">氏名（人数分・必須）</label>
              <div className="space-y-2">
                {Array.from({ length: partySize }).map((_, idx) => (
                  <input
                    key={idx}
                    className="w-full rounded border px-3 py-2"
                    type="text"
                    placeholder={`氏名 ${idx + 1}`}
                    value={playerNames[idx] ?? ''}
                    onChange={(e) => {
                      const next = [...playerNames]
                      next[idx] = e.target.value
                      setPlayerNames(next)
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="mb-2">時間: {selectedSlot ? `${fmt(selectedSlot.start)} - ${fmt(selectedSlot.end)}` : ''}</div>
            <div className="flex gap-2">
              <button className="flex-1 rounded border px-3 py-2" onClick={() => setSelectedSlot(null)}>
                キャンセル
              </button>
              <button
                className="flex-1 rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-60"
                disabled={createMutation.isPending}
                onClick={async () => {
                  try {
                    if (playerNames.some((n) => !n || !n.trim())) {
                      alert('人数分の氏名を入力してください')
                      return
                    }
                    const idemKey = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
                    await createMutation.mutateAsync({
                      idemKey,
                      payload: {
                        courtId: selectedCourt,
                        date,
                        startMin: selectedSlot.start,
                        endMin: selectedSlot.end,
                        partySize,
                        playerNames: playerNames.map((n) => n.trim()),
                      },
                    })
                    setSelectedSlot(null)
                    setPlayerNames(Array.from({ length: partySize }, () => ''))
                  } catch (e: any) {
                    // onError handler alerts; no duplicate alert here
                  }
                }}
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
