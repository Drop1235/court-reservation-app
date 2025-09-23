/* eslint-disable react/no-unescaped-entities */
"use client"
import { useEffect, useMemo, useState, Fragment, useRef, useCallback } from 'react'
import { makeSlots, DEFAULT_END_MIN, DEFAULT_SLOT_MINUTES, DEFAULT_START_MIN } from '@/src/lib/time'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { format } from 'date-fns'

const DEFAULT_COURT_COUNT = 4
const MAX_COURTS = 21

export default function ReservePage() {
  const qc = useQueryClient()
  const [date, setDate] = useState<string>('-')
  const [lastRefAt, setLastRefAt] = useState<Date | null>(null)
  const [selectedCourt, setSelectedCourt] = useState<number>(1)
  const [partySize, setPartySize] = useState(2)
  const [playerNames, setPlayerNames] = useState<string[]>([''])
  const [courtCount, setCourtCount] = useState<number>(DEFAULT_COURT_COUNT)
  const [courtNames, setCourtNames] = useState<string[]>(Array.from({ length: DEFAULT_COURT_COUNT }, (_, i) => String.fromCharCode(65 + i)))
  const [startMin, setStartMin] = useState<number>(DEFAULT_START_MIN)
  const [endMin, setEndMin] = useState<number>(DEFAULT_END_MIN)
  const [slotMinutes, setSlotMinutes] = useState<number>(DEFAULT_SLOT_MINUTES)
  // responsive: adjust grid density for tablet/desktop so more courts fit
  const [colMinPx, setColMinPx] = useState<number>(120)
  const [timeColPx, setTimeColPx] = useState<number>(64)
  const [isMobile, setIsMobile] = useState<boolean>(false)
  const [colPx, setColPx] = useState<number>(120)

  // client-only render guard to avoid hydration mismatch
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // レスポンシブレイアウト調整: 画面幅とコート数に合わせて列幅を動的計算（PCでは全コートが1画面に入るよう最優先）
  useEffect(() => {
    if (typeof window === 'undefined') return
    const apply = () => {
      const w = window.innerWidth
      const h = window.innerHeight || 1
      const aspect = w / h
      setIsMobile(w < 640)
      if (w >= 640) {
        // 目標: ビューポート幅に全コート + 時間列をぴったり収める
        // 時間列幅は画面が広いほど小さめ
        const timeCol = w >= 1600 || aspect > 1.9 ? 44 : w >= 1280 || aspect > 1.6 ? 48 : 52
        // デスクトップは固定px幅ではなく、全幅を使って1frで自動的に広がるようにする
        setTimeColPx(timeCol)
        setColMinPx(40)
        setColPx(40)
      } else {
        // モバイルは広すぎないよう標準値
        setColMinPx(110)
        setTimeColPx(60)
        setColPx(110)
      }
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [courtCount])

  // Single-day mode: fetch active day config once
  const { data: dayCfg } = useQuery({
    queryKey: ['day'],
    queryFn: async () => (await axios.get('/api/day', { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } })).data,
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
  // React to admin saves from other tabs/windows via localStorage broadcast
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dayCfgUpdated') {
        qc.invalidateQueries({ queryKey: ['day'] })
        qc.refetchQueries({ queryKey: ['day'] })
        setLastRefAt(new Date())
      }
      if (e.key === 'resUpdated') {
        // Names edited from admin; refresh current date's reservations
        qc.invalidateQueries({ queryKey: ['reservations', date] })
        qc.refetchQueries({ queryKey: ['reservations', date] })
        setLastRefAt(new Date())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [qc, date])

  // Safely formatted date label for UI (avoid crashing on invalid date strings)
  const dateLabel = useMemo(() => {
    try {
      if (!date || date === '-' || isNaN(Date.parse(date))) return date || '-'
      return format(new Date(date), 'yyyy-MM-dd')
    } catch {
      return date || '-'
    }
  }, [date])

  useEffect(() => {
    if (!dayCfg) return
    try {
      const dstr = format(new Date(dayCfg.date), 'yyyy-MM-dd')
      setDate(dstr)
      const cnt = Math.min(Math.max(dayCfg.courtCount ?? DEFAULT_COURT_COUNT, 1), MAX_COURTS)
      setCourtCount(cnt)
      const names = Array.isArray(dayCfg.courtNames) ? dayCfg.courtNames.slice(0, cnt) : []
      const finalNames = Array.from({ length: cnt }, (_, i) => {
        const raw = (names[i] ?? '').toString().trim()
        return raw || String.fromCharCode(65 + i)
      })
      setCourtNames(finalNames)
      setStartMin(typeof dayCfg.startMin === 'number' ? dayCfg.startMin : DEFAULT_START_MIN)
      setEndMin(typeof dayCfg.endMin === 'number' ? dayCfg.endMin : DEFAULT_END_MIN)
      setSlotMinutes(typeof dayCfg.slotMinutes === 'number' ? dayCfg.slotMinutes : DEFAULT_SLOT_MINUTES)
    } catch {}
  }, [dayCfg])

  // keep selectedCourt in range
  useEffect(() => {
    setSelectedCourt((c) => (c > courtCount ? 1 : c))
  }, [courtCount])

  // removed: localStorage editors (now admin-only)

  const slots = useMemo(() => makeSlots(startMin, endMin, slotMinutes), [startMin, endMin, slotMinutes])

  // Pretty colors for court header badges (cycles if courts > color count)
  const courtColors = [
    'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200',
    'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200',
    'bg-pink-50 text-pink-700 ring-1 ring-pink-200',
    'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
    'bg-lime-50 text-lime-700 ring-1 ring-lime-200',
  ]

  const etagRef = useRef<string | null>(null)
  // Keep optimistic temps visible even if a background refetch returns without the new row yet
  const tempsRef = useRef<any[]>([])
  const [fastPoll, setFastPoll] = useState(false)
  const { data: reservations, isFetching: isResFetching } = useQuery({
    queryKey: ['reservations', date],
    // Add no-cache header so browser/CDN revalidates immediately after a mutation
    queryFn: async () => {
      const headers: Record<string,string> = { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      if (etagRef.current) headers['If-None-Match'] = etagRef.current
      const res = await axios.get(`/api/reservations?date=${date}`, { headers })
      const etag = res.headers['etag'] || res.headers['ETag']
      if (etag) etagRef.current = etag as string
      // Merge server data with any optimistic temps (avoid duplicates by id)
      const server = Array.isArray(res.data) ? res.data.slice() : []
      // Clean up temps that are now present in server data (use server list, not merged)
      tempsRef.current = tempsRef.current.filter((t) => !server.some((r: any) => r.id === t.id))
      // Adjust polling speed based on presence of temps or ongoing mutation
      setFastPoll(tempsRef.current.length > 0 || createMutation.isPending)
      const merged = server.slice()
      for (const t of tempsRef.current) {
        if (!merged.some((r: any) => r.id === t.id)) merged.push(t)
      }
      return merged
    },
    refetchOnWindowFocus: true,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    // Avoid firing before day config sets a valid date
    enabled: !!date && date !== '-',
  })

  // Record last refresh time whenever reservations data changes
  useEffect(() => {
    if (reservations !== undefined) setLastRefAt(new Date())
  }, [reservations])

  // When the date changes, reset ETag and temporary optimistic entries to avoid stale 304 caches
  useEffect(() => {
    etagRef.current = null
    tempsRef.current = []
  }, [date])

  // Merge current data with temps for UI calculations
  const currentWithTemps = () => {
    const base = Array.isArray(reservations) ? reservations.slice() : []
    for (const t of tempsRef.current) {
      if (!base.some((r: any) => r.id === t.id)) base.push(t)
    }
    return base
  }

  const usedCapacity = useCallback((start: number, end: number, courtId: number) => {
    const list = currentWithTemps()
    return list
      .filter((r: any) => r.courtId === courtId && Math.max(r.startMin, start) < Math.min(r.endMin, end))
      .reduce((acc: number, r: any) => acc + r.partySize, 0)
  }, [reservations])

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
      setFastPoll(true)
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
      // If no temps remain and no ongoing mutation, slow down
      if (tempsRef.current.length === 0 && !createMutation.isPending) setFastPoll(false)
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
      // Keep the created record pinned until server GET includes it
      if (ctx?.tempId) {
        tempsRef.current = [
          ...tempsRef.current.filter((x) => x.id !== ctx.tempId),
          created,
        ]
      }
      // Also trigger a background refetch to reconcile with server state
      etagRef.current = null // force next poll to fetch fresh
      // Guarantee network gets the newest snapshot (bypass CDN/browser cache once)
      try {
        const resNow = await axios.get(`/api/reservations?date=${date}&_=${Date.now()}`,
          { headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' } })
        // Merge temps into the fresh payload just in case success of other mutation is still pending
        const serverFresh = Array.isArray(resNow.data) ? resNow.data.slice() : []
        // Clean up temps that now appear in server data (use server list, not merged)
        tempsRef.current = tempsRef.current.filter((t) => !serverFresh.some((r: any) => r.id === t.id))
        const mergedFresh = serverFresh.slice()
        for (const t of tempsRef.current) {
          if (!mergedFresh.some((r: any) => r.id === t.id)) mergedFresh.push(t)
        }
        qc.setQueryData(['reservations', date], mergedFresh)
      } catch {
        // ignore; periodic refetch will still sync
      }
      // Additionally let react-query do a standard refetch for consistency
      await qc.refetchQueries({ queryKey: ['reservations', date] })
      // If temps are cleared, allow poll to slow down
      if (tempsRef.current.length === 0 && !createMutation.isPending) setFastPoll(false)
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
  }, [selectedSlot, selectedCourt, reservations, usedCapacity])
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
  const renderTimeSlot = (start: number, end: number, isTemp = false) => (courtId: number) => {
    const list = currentWithTemps()
    return list
      .filter((r: any) => r.courtId === courtId && Math.max(r.startMin, start) < Math.min(r.endMin, end))
      .map((r: any) => ({ id: r.id, names: Array.isArray(r.playerNames) ? r.playerNames : [], isTemp: r.__temp === true }))
  }

  const fmt = (min: number) => {
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }


const ReservationCell = ({ courtId, start, end, onClick, isSelected, isAvailable, isFull, names, isTemp = false, used = 0 }: any) => {
  // Background color cues by capacity / availability
  const capacityBg = !isAvailable
    ? 'bg-gray-100'
    : used === 0
      ? 'bg-white'
      : used >= 4
        ? 'bg-gray-100'
        : 'bg-green-50'

  // Border hint for temp rows
  const tempStyles = isTemp ? 'bg-blue-50 border border-blue-200' : ''

  return (
    <div className="relative h-full">
      <button
        type="button"
        className={`block h-full w-full text-left p-1 md:p-1 lg:p-1 rounded-md text-[11px] md:text-[10px] ${capacityBg} ${tempStyles} ${isFull || !isAvailable ? 'cursor-not-allowed text-gray-400' : 'hover:bg-blue-50 transition-colors'} ${isSelected ? 'ring-2 ring-blue-400' : ''}`}
        onClick={(isFull || !isAvailable) ? undefined : onClick}
        aria-busy={isTemp}
        aria-disabled={isFull || !isAvailable}
      >
        {isTemp && (
          <span className="absolute -top-1.5 -right-1 bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full shadow">
            送信中…
          </span>
        )}
        {names.map((name: string, i: number) => (
          <div key={i} className="truncate leading-tight">{name}</div>
        ))}
        <span className="absolute bottom-1 right-1 rounded bg-white/70 px-1 text-[9px] md:text-[10px] text-gray-600 shadow-sm">{used}/4</span>
      </button>
    </div>
  )
}
  const namesForSlot = (start: number, end: number, courtId: number) => {
    const list = currentWithTemps()
    return list
      .filter((r: any) => r.courtId === courtId && Math.max(r.startMin, start) < Math.min(r.endMin, end))
      .flatMap((r: any) => (Array.isArray(r.playerNames) ? r.playerNames : []))
  }

  const isTimeSlotAvailable = (start: number, end: number, courtId: number) => {
    // available if not full
    return usedCapacity(start, end, courtId) < 4
  }

  if (!mounted) return null

  return (
    <div className="w-full max-w-none overflow-x-hidden space-y-3">
      {/* Important notice */}
      <div className="mb-1">
        <div className="rounded-md border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-800 w-full">
          <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800 shadow-sm">
            <p className="font-bold">※システム不具合時は、大会本部で予約を受け付けます。</p>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-2 font-bold">【重要】予約に関するお願い</p>
              <ul className="mb-1 ml-4 list-disc space-y-1">
                <li>予約開始は前日の午後8時からです。</li>
                <li>お一人様1枠まで。（終了後は再予約可）</li>
                <li>
                  以下の場合は削除します：
                  <ul className="ml-5 list-none space-y-1">
                    <li>・2枠以上の予約</li>
                    <li>・予約開始時刻より前の予約</li>
                    <li>・名前が漢字フルネーム以外の予約（漢字以外の方は本名をそのまま記入でOK）</li>
                    <li>・大会に出場していない選手の予約</li>
                    <li>・偽名での予約</li>
                  </ul>
                </li>
                <li>選手は漢字フルネーム、選手以外の練習相手は「コーチ」と入力してください。</li>
                <li>キャンセル・変更・質問は、以下の「WhatsAppで連絡する」よりご連絡ください。</li>
              </ul>
            </div>
            <div>
              <a
                href="https://wa.me/message/QNM5DYVOU27GD1"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded border border-green-300 bg-white px-3 py-2 text-sm text-green-700 shadow-sm hover:bg-green-50 hover:underline"
              >
                WhatsAppで連絡する
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-1 flex items-center justify-between gap-3 rounded-lg border bg-white/80 px-2 py-1 backdrop-blur w-full">
        <div className="flex items-center gap-2 min-w-0">
          <div className="rounded border px-2 py-1 text-sm bg-white whitespace-nowrap shadow-sm">{dateLabel}</div>
          <div className="text-xs sm:text-sm text-gray-600 whitespace-nowrap shrink-0">コート数: {courtCount}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10px] sm:text-xs text-gray-400 whitespace-nowrap">最終更新: {lastRefAt ? format(lastRefAt, 'HH:mm:ss') : '-'}</div>
          <button
            type="button"
            className="rounded border px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-60"
            disabled={isResFetching}
            onClick={async () => {
              await qc.invalidateQueries({ queryKey: ['day'] })
              await qc.refetchQueries({ queryKey: ['day'] })
              await qc.invalidateQueries({ queryKey: ['reservations', date] })
              await qc.refetchQueries({ queryKey: ['reservations', date] })
              setLastRefAt(new Date())
            }}
            aria-busy={isResFetching}
          >{isResFetching ? '更新中…' : '更新'}</button>
        </div>
      </div>

      <div className="mt-1">
        <div className={`overflow-auto rounded-xl border bg-white shadow-md w-full`}>
          <div
            className={`grid w-full ${isMobile ? 'min-w-max' : ''}`}
            style={isMobile ? {
              gridTemplateColumns: `${timeColPx}px repeat(${courtCount}, minmax(${colMinPx}px, 1fr))`,
            } : {
              gridTemplateColumns: `${timeColPx}px repeat(${courtCount}, minmax(72px, 1fr))`,
            }}
          >
            <div className="sticky top-0 left-0 z-30 bg-white/95 backdrop-blur p-1 text-[11px] md:text-xs font-bold text-gray-600 shadow after:absolute after:inset-y-0 after:-right-px after:w-px after:bg-gray-200">時間</div>
            {Array.from({ length: courtCount }, (_, i) => (
              <div key={`h-${i}`} className="sticky top-0 z-20 bg-white/95 backdrop-blur p-1 text-center border-b border-gray-200 shadow-sm">
                <span className={`inline-block whitespace-nowrap px-2 py-0.5 text-[10px] md:text-xs font-medium rounded-full ${courtColors[i % courtColors.length]}`}>
                  {courtNames[i] ?? String.fromCharCode(65 + i)}
                </span>
              </div>
            ))}

            {slots.map(({ start: s, end: e }, rowIdx) => (
              <Fragment key={`row-${rowIdx}`}>
                <div className="sticky left-0 z-10 flex flex-col items-center justify-center border-t p-1 text-[10px] md:text-[11px] leading-tight text-gray-600 bg-white shadow after:absolute after:inset-y-0 after:-right-px after:w-px after:bg-gray-200">
                  <div className="whitespace-nowrap">{fmt(s).replace(':','：')}～</div>
                  <div className="whitespace-nowrap">{fmt(e).replace(':','：')}</div>
                </div>
                {Array.from({ length: courtCount }, (_, ci) => {
                  const courtId = ci + 1
                  const names = namesForSlot(s, e, courtId)
                  const used = usedCapacity(s, e, courtId)
                  const full = used >= 4
                  const isTemp = currentWithTemps().some(r => r.courtId === courtId && r.startMin === s && r.endMin === e && r.__temp === true)
                  return (
                    <div key={`c-${rowIdx}-${courtId}`} className="border-t border-l">
                      <ReservationCell
                        courtId={courtId}
                        start={s}
                        end={e}
                        onClick={() => {
                          // Guard: avoid opening modal when date is not yet valid
                          if (!date || date === '-' || isNaN(Date.parse(date))) return
                          if (full) return
                          setSelectedCourt(courtId)
                          setSelectedSlot({ start: s, end: e })
                        }}
                        isSelected={!!selectedSlot && selectedCourt === courtId && selectedSlot.start === s && selectedSlot.end === e}
                        isAvailable={isTimeSlotAvailable(s, e, courtId)}
                        isFull={full}
                        names={names}
                        isTemp={isTemp}
                        used={used}
                      />
                    </div>
                  )
                })}
              </Fragment>
            ))}
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
              <p className="mb-1 text-sm font-bold text-red-600">漢字フルネームで入力してください。漢字以外の方は本名をそのまま記入してください。</p>
              <p className="mb-2 text-sm font-bold text-red-600">漢字フルネーム以外は、見つけ次第削除します。</p>
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
                    const namesToCheck = playerNames.slice(0, partySize)
                    if (namesToCheck.length !== partySize || namesToCheck.some((n) => !n || n.trim().length === 0)) {
                      alert('人数分の氏名を入力してください')
                      return
                    }
                    // Front-end rule: コーチは選手1名に対して1名まで
                    {
                      const coachCount = namesToCheck.filter((n) => n.trim() === 'コーチ').length
                      const playerCount = namesToCheck.length - coachCount
                      if (coachCount > playerCount) {
                        alert('コーチは選手1名につき1名までです。氏名の入力を見直してください。')
                        return
                      }
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
                        // 全角/半角スペース・改行などの空白をすべて削除して送信
                        playerNames: playerNames.map((n) => n.replace(/\s+/g, '')), 
                        clientNowMin: (() => { const now = new Date(); return now.getHours()*60 + now.getMinutes() })(),
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
