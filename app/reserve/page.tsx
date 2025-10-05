/* eslint-disable react/no-unescaped-entities */
"use client"
import { useEffect, useMemo, useState, Fragment, useRef, useCallback } from 'react'
import { makeSlots, DEFAULT_END_MIN, DEFAULT_SLOT_MINUTES, DEFAULT_START_MIN } from '@/src/lib/time'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { format } from 'date-fns'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const DEFAULT_COURT_COUNT = 4
const MAX_COURTS = 21

export default function ReservePage() {
  // Treat single line breaks as <br> in Markdown and enable GFM for better link handling
  marked.setOptions({ breaks: true, gfm: true })
  const qc = useQueryClient()
  const [date, setDate] = useState<string>('-')
  const [lastRefAt, setLastRefAt] = useState<Date | null>(null)
  const [selectedCourt, setSelectedCourt] = useState<number>(1)
  const [partySize, setPartySize] = useState(2)
  const [playerNames, setPlayerNames] = useState<string[]>([''])
  // IME composition tracking per input index to avoid double characters during Japanese input
  const [isComposingMap, setIsComposingMap] = useState<Record<number, boolean>>({})
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
        // モバイル: 横スクロールなしで3コート程度見えるよう最小幅を小さく
        setColMinPx(80)
        setTimeColPx(48)
        setColPx(80)
      }

  // Admin PIN gating removed by request; capture is controlled only by localStorage flag 'captureOnUpdate'.

    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [courtCount])

  // Single-day mode: fetch active day config once
  const { data: dayCfg, isFetching: isDayFetching, isRefetching: isDayRefetching } = useQuery({
    queryKey: ['day'],
    queryFn: async () => (await axios.get('/api/day', { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } })).data,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    retry: false,
    placeholderData: undefined,
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

  // Render admin notice (Markdown -> sanitized HTML)
  const noticeHtml = useMemo(() => {
    try {
      const raw = String((dayCfg as any)?.notice || '')
      if (!raw.trim()) return ''
      // 0) Lightweight shortcode preprocessing for color/size/weight
      //    Examples: [red]重要[/red], [blue]info[/blue], [size=lg]大きめ[/size], [b]太字[/b]
      const colorMap: Record<string,string> = {
        red: 'text-red-600',
        blue: 'text-blue-700',
        green: 'text-green-700',
        orange: 'text-orange-600',
        gray: 'text-gray-700',
      }
      const sizeMap: Record<string,string> = {
        sm: 'text-sm',
        base: 'text-base',
        lg: 'text-lg',
        xl: 'text-xl',
        '2xl': 'text-2xl',
      }
      let input = raw
        // color blocks
        .replace(/\[(red|blue|green|orange|gray)\]([\s\S]*?)\[\/\1\]/g, (_m, c, t) => `<span class="${colorMap[c]}">${t}</span>`)
        // size blocks
        .replace(/\[size=(sm|base|lg|xl|2xl)\]([\s\S]*?)\[\/size\]/g, (_m, s, t) => `<span class="${sizeMap[s]}">${t}</span>`)
        // bold block (Markdown **text** でも可)
        .replace(/\[b\]([\s\S]*?)\[\/b\]/g, (_m, t) => `<span class="font-bold">${t}</span>`)

      // Keep authoring as-is; rely on Markdown parser (GFM autolink) to convert URLs
      let parsed = marked.parse(input) as string
      // Make links open in new tab and look clickable like buttons
      let withTargets = parsed
        .replaceAll('<a ', '<a target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 rounded border border-blue-300 bg-white px-2 py-1 text-blue-700 underline underline-offset-2 hover:bg-blue-50 hover:text-blue-800 transition-colors" ')
      // Normalize hrefs missing scheme (e.g., chat.whatsapp.com/...) to https://
      withTargets = withTargets
        .replace(/href="\/\/(.*?)"/g, 'href="https://$1"')
        .replace(/href="(chat\.whatsapp\.com[^"]*)"/g, 'href="https://$1"')
      return DOMPurify.sanitize(withTargets)
    } catch { return '' }
  }, [dayCfg])

  // Extract first valid URL from potentially malformed markdown link
  const extractUrl = (text: string): string | null => {
    // Try to extract URL from markdown link format [text](url)
    const markdownLinkMatch = text.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/i)
    if (markdownLinkMatch && markdownLinkMatch[2]) {
      return markdownLinkMatch[2]
    }
    // Try to extract plain URL
    const urlMatch = text.match(/(https?:\/\/[^\s\]\)]+)/i)
    return urlMatch ? urlMatch[0] : null
  }

  // Delegated click handler: ensure external links open in new tab reliably
  const noticeBoxRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = noticeBoxRef.current
    if (!el) return

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const anchor = target?.closest?.('a') as HTMLAnchorElement | null
      if (!anchor) return

      let href = anchor.getAttribute('href') || ''
      
      // Extract clean URL from potentially malformed href
      const cleanUrl = extractUrl(href) || href
      
      // Normalize URL
      let finalUrl = cleanUrl
      if (/^\/?\//.test(cleanUrl)) {
        finalUrl = 'https:' + cleanUrl.replace(/^\/?\//, '')
      } else if (/^(chat\.whatsapp\.com)/i.test(cleanUrl) && !/^https?:\/\//i.test(cleanUrl)) {
        finalUrl = 'https://' + cleanUrl
      }
      
      // Only process if it looks like a valid URL
      if (/^https?:\/\//i.test(finalUrl) || /^whatsapp:/i.test(finalUrl)) {
        e.preventDefault()
        e.stopPropagation()
        
        // Clean up any remaining markdown artifacts
        const cleanedUrl = finalUrl.split(')')[0].trim()
        
        const win = window.open(cleanedUrl, '_blank', 'noopener,noreferrer')
        if (!win) {
          // Fallback when popups are blocked
          window.location.href = cleanedUrl
        }
      }
    }
    
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [noticeHtml])

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
  // Screenshot target: main grid wrapper and inner grid
  const gridRef = useRef<HTMLDivElement | null>(null)
  const gridInnerRef = useRef<HTMLDivElement | null>(null)
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
      // Trigger a lightweight refetch via react-query; rely on standard query to update
      etagRef.current = null // force next poll to fetch fresh
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

  // 予約取消用の4桁PIN（ユーザー自身で設定）
  const [pin, setPin] = useState<string>('')

  // Which modal to show for the currently selected slot
  const [actionMode, setActionMode] = useState<'reserve' | 'choose' | null>(null)

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

  // --- Screenshot utilities (client-only) ---
  const loadHtml2Canvas = async (): Promise<any> => {
    if (typeof window === 'undefined') return null
    if ((window as any).html2canvas) return (window as any).html2canvas
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('failed to load html2canvas'))
      document.head.appendChild(s)
    })
    return (window as any).html2canvas
  }

  // Inject styles used during capture to neutralize sticky and visual effects
  const ensureCaptureStyles = () => {
    if (typeof document === 'undefined') return
    const id = 'capture-mode-styles'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      .capture-mode .sticky { position: static !important; top: auto !important; left: auto !important; }
      .capture-mode .shadow, .capture-mode .shadow-sm, .capture-mode .shadow-md, .capture-mode .shadow-lg { box-shadow: none !important; }
      .capture-mode .backdrop-blur { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
    `
    document.head.appendChild(style)
  }

  const captureAndDownload = async (el: HTMLElement, filename: string) => {
    try {
      const html2canvas = await loadHtml2Canvas()
      if (!html2canvas) return
      ensureCaptureStyles()
      const container = gridRef.current
      if (container) {
        container.scrollTop = 0
        container.scrollLeft = 0
        container.classList.add('capture-mode')
      }
      const width = (el as HTMLElement).scrollWidth || (el as HTMLElement).clientWidth
      const height = (el as HTMLElement).scrollHeight || (el as HTMLElement).clientHeight
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        foreignObjectRendering: false,
        width,
        height,
        windowWidth: Math.max(width, window.innerWidth),
        windowHeight: Math.max(height, window.innerHeight),
      })
      if (container) container.classList.remove('capture-mode')
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
    } catch {
      // fail silently; screenshot is a convenience feature for the local user only
    }
  }



const ReservationCell = ({ courtId, start, end, onClick, isSelected, isAvailable, isFull, names, isTemp = false, used = 0, isMobile = false, isBlocked = false }: any) => {
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
        className={`block h-full w-full text-left p-1 md:p-1 lg:p-1 rounded-md text-[11px] md:text-[10px] ${capacityBg} ${tempStyles} ${isBlocked ? 'cursor-not-allowed opacity-70' : 'hover:bg-blue-50 transition-colors'} ${isSelected ? 'ring-2 ring-blue-400' : ''}`}
        onClick={(e) => { if (isBlocked) return; onClick?.(e) }}
        aria-busy={isTemp}
        aria-disabled={isBlocked}
      >
        {isBlocked && (
          <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold text-red-700/90">
            予約不可
          </span>
        )}
        {isTemp && (
          <span className="absolute -top-1.5 -right-1 bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full shadow">
            送信中…
          </span>
        )}
        {/* Desktop/Tablet: show list of names */}
        <div className="hidden sm:block">
          {names.map((name: string, i: number) => (
            <div key={i} className="truncate leading-tight">{name}</div>
          ))}
        </div>
        {/* Mobile: show all names one per line */}
        <div className="sm:hidden text-[10px] text-gray-800 space-y-0.5 pr-6">
          {Array.isArray(names) && names.map((name: string, i: number) => (
            <div key={i} className="leading-tight break-words">{name}</div>
          ))}
        </div>
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

  const blocks: any[] = Array.isArray((dayCfg as any)?.blocks) ? (dayCfg as any).blocks : []
  const isBlocked = (start: number, end: number, courtId: number) => {
    return blocks.some((b: any) => b.courtId === courtId && Math.max(Number(b.startMin||0), start) < Math.min(Number(b.endMin||0), end))
  }
  const isTimeSlotAvailable = (start: number, end: number, courtId: number) => {
    // available if not full
    if (isBlocked(start, end, courtId)) return false
    return usedCapacity(start, end, courtId) < 4
  }

  if (!mounted) return null

  // Maintenance mode: show preparing screen and block interactions
  if (dayCfg && (dayCfg as any).preparing === true) {
    return (
      <div className="w-full min-h-[60vh] grid place-items-center p-6">
        <div className="w-full max-w-lg rounded-xl border bg-white shadow p-6 text-center">
          <div className="text-2xl font-bold mb-2">準備中</div>
          <p className="text-gray-700 mb-4">現在、管理画面で次の日の予約枠を設定中のため、一時的に予約を停止しています。</p>
          <p className="text-gray-600 mb-6">しばらくしてから再度アクセスしてください。</p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              className="rounded border px-3 py-2 hover:bg-gray-50"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['day'] })
                qc.refetchQueries({ queryKey: ['day'] })
              }}
            >更新</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-none overflow-x-hidden space-y-3">
      {/* Important notice (admin-editable) */}
      {!isDayFetching && !isDayRefetching && noticeHtml && (
        <div className="mb-1 relative z-10">
          <div ref={noticeBoxRef} className="rounded-md border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-800 w-full pointer-events-auto">
            <div className="leading-relaxed [&_img]:rounded pointer-events-auto [&_p]:mb-3 [&_br]:block [&_br]:h-3" dangerouslySetInnerHTML={{ __html: noticeHtml }} />
          </div>
        </div>
      )}

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
              // After refresh, optionally capture a screenshot of the grid for local download
              try {
                if (typeof window !== 'undefined' && localStorage.getItem('captureOnUpdate') === '1') {
                  // wait for re-render to finish (double rAF)
                  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
                  const el = gridInnerRef.current || gridRef.current
                  if (el) {
                    const now = new Date()
                    const stamp = format(now, 'yyyyMMdd_HHmmss')
                    const fname = `reserve_${dateLabel}_${stamp}.png`
                    await captureAndDownload(el, fname)
                  }
                }
              } catch {}
            }}
            aria-busy={isResFetching}
          >{isResFetching ? '更新中…' : '更新'}</button>
        </div>
      </div>

      <div className="mt-1">
        <div ref={gridRef} className={`overflow-auto rounded-xl border bg-white shadow-md w-full max-h-[70vh] sm:max-h-[75vh] md:max-h-[78vh] lg:max-h-[80vh] overscroll-contain`}>
          <div ref={gridInnerRef}
            className={`grid w-full ${isMobile ? 'min-w-0' : ''}`}
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
                          if (isBlocked(s, e, courtId)) return
                          setSelectedCourt(courtId)
                          setSelectedSlot({ start: s, end: e })
                          // If there is already someone in this slot, first ask the user what to do
                          try {
                            const existing = currentWithTemps()
                              .filter((r: any) => r.__temp !== true)
                              .filter((r: any) => r.courtId === courtId && Math.max(r.startMin, s) < Math.min(r.endMin, e))
                            if (existing.length > 0) {
                              // When full or partially filled, allow user to choose delete
                              setActionMode('choose')
                            } else {
                              setActionMode('reserve')
                            }
                          } catch {
                            setActionMode('reserve')
                          }
                        }}
                        isSelected={!!selectedSlot && selectedCourt === courtId && selectedSlot.start === s && selectedSlot.end === e}
                        isAvailable={isTimeSlotAvailable(s, e, courtId)}
                        isFull={full}
                        names={names}
                        isTemp={isTemp}
                        used={used}
                        isMobile={isMobile}
                        isBlocked={isBlocked(s, e, courtId)}
                      />
                    </div>
                  )
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      {selectedSlot && actionMode === 'reserve' && (
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
              <p className="mb-1 text-sm font-bold text-red-600">選手は漢字フルネーム（本名そのまま）で入力してください。「コーチ」は入力不可です。練習相手名として「looking」は複数入力可です。</p>
              <p className="mb-2 text-sm font-bold text-red-600">不正予約は、見つけ次第削除します。</p>
              <div className="space-y-2">
                {Array.from({ length: partySize }).map((_, idx) => (
                  <input
                    key={idx}
                    className="w-full rounded border px-3 py-2"
                    type="text"
                    placeholder={`氏名 ${idx + 1}`}
                    value={playerNames[idx] ?? ''}
                    onCompositionStart={() => {
                      setIsComposingMap((m) => ({ ...m, [idx]: true }))
                    }}
                    onCompositionEnd={(e) => {
                      // Allow Kanji, Hiragana, Katakana, Latin letters, and the prolonged sound mark 'ー'
                      const allowRe = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z\u30FC]/u
                      const raw = (e.currentTarget.value || '').normalize('NFKC')
                      // Normalize hyphen-like characters to the standard choonpu 'ー'
                      const pre = raw.replace(/[-－―ｰ]/g, 'ー')
                      const filtered = Array.from(pre.replace(/\s+/g, ''))
                        .filter((ch) => allowRe.test(ch))
                        .join('')
                        .slice(0, 12)
                      setIsComposingMap((m) => ({ ...m, [idx]: false }))
                      setPlayerNames((prev) => {
                        const next = [...prev]
                        next[idx] = filtered
                        return next
                      })
                    }}
                    onChange={(e) => {
                      const composing = !!isComposingMap[idx]
                      if (composing) {
                        // During IME composition, do not sanitize; just mirror raw value
                        const val = e.target.value
                        setPlayerNames((prev) => {
                          const next = [...prev]
                          next[idx] = val
                          return next
                        })
                        return
                      }
                      const allowRe = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z\u30FC]/u
                      const raw = (e.target.value || '').normalize('NFKC')
                      // Normalize hyphen-like characters to the standard choonpu 'ー'
                      const pre = raw.replace(/[-－―ｰ]/g, 'ー')
                      // remove spaces (half/full) and invalid chars, then cap to 12
                      const filtered = Array.from(pre.replace(/\s+/g, ''))
                        .filter((ch) => allowRe.test(ch))
                        .join('')
                        .slice(0, 12)
                      const next = [...playerNames]
                      next[idx] = filtered
                      setPlayerNames(next)
                    }}
                  />
                ))}
                <div className="text-xs text-gray-500">入力ルール: 全角12文字まで。使用できる文字は「漢字・ひらがな・カタカナ・英字・長音（ー）」のみ。</div>
              </div>
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-sm font-medium">暗証番号（4桁・取消時に必要）</label>
              <input
                className="w-full rounded border px-3 py-2"
                type="password"
                inputMode="numeric"
                pattern="\\d{4}"
                maxLength={4}
                placeholder="例: 1234"
                value={pin}
                onChange={(e) => {
                  const v = e.target.value
                    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30))
                    .replace(/[^0-9]/g, '')
                  setPin(v)
                }}
              />
              <p className="mt-1 text-xs text-gray-500">この番号を知っていれば誰でもこの予約を取消できます。</p>
            </div>
            <div className="mb-2">時間: {selectedSlot ? `${fmt(selectedSlot.start)} - ${fmt(selectedSlot.end)}` : ''}</div>
            <div className="flex gap-2">
              <button className="flex-1 rounded border px-3 py-2" onClick={() => { setSelectedSlot(null); setPin(''); setActionMode(null) }}>
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
                    // Validate name characters and length (serverでも検証)
                    {
                      const nameOk = (s: string) => {
                        // Normalize and allow choonpu 'ー'
                        const s2 = s
                          .normalize('NFKC')
                          .replace(/[\s]+/g, '')
                          .replace(/[-－―ｰ]/g, 'ー')
                        if (s2.length === 0 || s2.length > 12) return false
                        return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z\u30FC]+$/u.test(s2)
                      }
                      if (namesToCheck.some((n) => !nameOk(n))) {
                        alert('氏名は全角12文字まで。漢字・ひらがな・カタカナ・英字・長音「ー」のみ使用できます。')
                        return
                      }
                    }
                    // PIN: 4桁の数字（全角→半角正規化済み）
                    if (!/^\d{4}$/.test(pin)) {
                      alert('暗証番号（4桁の数字）を入力してください')
                      return
                    }
                    // Front-end rule update:
                    // - 「コーチ」は1名もNG（表記ゆれを含め禁止）
                    // - "looking" は複数OK（大文字・全角でも保存時は小文字半角に正規化）
                    {
                      const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '')
                      const toKatakana = (s: string) => s.replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
                      const normalizeChoon = (s: string) => s
                        .replace(/[-－―ｰ]/g, 'ー')
                        .replace(/([ァ-ヶ])一([ァ-ヶ])/g, '$1ー$2')
                      const isCoach = (s: string) => {
                        const a = normalizeChoon(toKatakana(norm(s)))
                        return a === 'コーチ'
                      }
                      const hasCoach = namesToCheck.some((n) => isCoach(n))
                      if (hasCoach) {
                        alert('「コーチ」は入力できません。選手名のみ入力してください。')
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
                        // 全角/半角スペース・改行などの空白をすべて削除し、12文字に制限
                        // "looking" は大文字・全角でも小文字半角 "looking" に正規化
                        playerNames: playerNames.map((n) => {
                          const base = (n || '').normalize('NFKC').replace(/\s+/g, '').slice(0,12)
                          if (base.toLowerCase() === 'looking') return 'looking'
                          return base
                        }), 
                        pin,
                        clientNowMin: (() => { const now = new Date(); return now.getHours()*60 + now.getMinutes() })(),
                      },
                    })
                    setSelectedSlot(null)
                    setPlayerNames(Array.from({ length: partySize }, () => ''))
                    setPin('')
                    setActionMode(null)
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

      {/* Choose action modal: reserve remaining or delete an existing reservation */}
      {selectedSlot && actionMode === 'choose' && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/30 p-4 sm:place-items-center">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg">
            <div className="mb-1 text-lg font-semibold">この枠の操作 {format(new Date(date), 'yyyy-MM-dd')}</div>
            <div className="mb-3 text-sm text-gray-700">コート：{courtNames[selectedCourt-1] ?? `Court${selectedCourt}`}</div>
            <div className="mb-2 text-sm">時間: {`${fmt(selectedSlot.start)} - ${fmt(selectedSlot.end)}`}</div>
            <div className="mb-3">
              <div className="mb-1 text-sm font-medium">現在の予約</div>
              <ul className="space-y-2">
                {currentWithTemps()
                  .filter((r: any) => r.__temp !== true)
                  .filter((r: any) => r.courtId === selectedCourt && Math.max(r.startMin, selectedSlot.start) < Math.min(r.endMin, selectedSlot.end))
                  .map((r: any) => (
                    <li key={r.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded border px-3 py-2">
                      <div className="text-sm text-gray-900 space-y-0.5 break-words">
                        {Array.isArray(r.playerNames) && r.playerNames.map((name: string, i: number) => (
                          <div key={i} className="leading-tight">{name}</div>
                        ))}
                        <div className="text-xs text-gray-500">（{r.partySize}名）</div>
                      </div>
                      <button
                        className="mt-2 sm:mt-0 sm:ml-3 rounded border px-2 py-1 text-sm hover:bg-red-50"
                        onClick={async () => {
                          try {
                            const raw = typeof window !== 'undefined' ? window.prompt('取消用の暗証番号（4桁）を入力してください') : ''
                            if (!raw) return
                            const pinNorm = raw
                              .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30))
                              .replace(/[^0-9]/g, '')
                            if (!/^\d{4}$/.test(pinNorm)) { alert('4桁の数字を入力してください'); return }
                            await axios.delete(`/api/reservations/${r.id}`, { data: { pin: pinNorm } })
                            await qc.invalidateQueries({ queryKey: ['reservations', date] })
                            await qc.refetchQueries({ queryKey: ['reservations', date] })
                            setSelectedSlot(null)
                            setActionMode(null)
                          } catch (e: any) {
                            const msg = e?.response?.data?.error || e?.message || '取消に失敗しました'
                            if (typeof window !== 'undefined') alert(msg)
                          }
                        }}
                      >取消</button>
                    </li>
                  ))}
              </ul>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 rounded border px-3 py-2" onClick={() => { setSelectedSlot(null); setActionMode(null) }}>閉じる</button>
              <button
                className="flex-1 rounded bg-blue-600 px-3 py-2 text-white"
                onClick={() => setActionMode('reserve')}
              >残りを予約</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
