"use client"
import axios from 'axios'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'react'

const fmt = (min: number) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function AdminPage() {
  const qc = useQueryClient()
  // Persistently hide items considered deleted until server confirms they are gone
  const deletedRef = useRef<Set<string>>(new Set())
  const { data } = useQuery({
    queryKey: ['all-res'],
    queryFn: async () => {
      const res = await axios.get('/api/reservations', { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } })
      const server: any[] = Array.isArray(res.data) ? res.data : []
      // If server no longer returns some ids, drop them from deletedRef
      const serverIds = new Set<string>(server.map((r: any) => r.id))
      for (const id of Array.from(deletedRef.current)) {
        if (!serverIds.has(id)) deletedRef.current.delete(id)
      }
      // Hide deleted ids from the list
      return server.filter((r: any) => !deletedRef.current.has(r.id))
    },
    refetchOnWindowFocus: true,
  })
  const [q, setQ] = useState('')
  const [pin, setPin] = useState('')
  const [settingDate, setSettingDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  // removed: past bulk delete cutoff
  const [settingCount, setSettingCount] = useState<number>(4)
  const [settingNames, setSettingNames] = useState<string[]>(['Court1', 'Court2', 'Court3', 'Court4'])
  const [startMin, setStartMin] = useState<number>(9 * 60)
  const [endMin, setEndMin] = useState<number>(21 * 60)
  const [slotMinutes, setSlotMinutes] = useState<number>(30)

  // single-day admin state
  const [dayDate, setDayDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'))
  const [dayCourtCount, setDayCourtCount] = useState<number>(4)
  const [dayCourtCountInput, setDayCourtCountInput] = useState<string>('4')
  const [dayCourtNames, setDayCourtNames] = useState<string[]>(['A','B','C','D'])
  const [dayStartMin, setDayStartMin] = useState<number>(9 * 60)
  const [dayEndMin, setDayEndMin] = useState<number>(21 * 60)
  const [daySlotMinutes, setDaySlotMinutes] = useState<number>(30)
  const lastLoadedRef = useRef<{ date: string; courtCount: number; courtNames: string[]; startMin: number; endMin: number; slotMinutes: number } | null>(null)

  // Auto-load day config on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get('/api/day', { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } })
        const d = res.data
        if (!d) return
        const loaded = {
          date: format(new Date(d.date), 'yyyy-MM-dd'),
          courtCount: Math.max(1, Math.min(8, d.courtCount || 4)),
          courtNames: Array.from({ length: Math.max(1, Math.min(8, d.courtCount || 4)) }, (_, i) => (d.courtNames?.[i]) || `Court${i + 1}`),
          startMin: d.startMin ?? 9 * 60,
          endMin: d.endMin ?? 21 * 60,
          slotMinutes: d.slotMinutes ?? 30,
        }
        lastLoadedRef.current = loaded
        setDayDate(loaded.date)
        setDayCourtCount(loaded.courtCount)
        setDayCourtCountInput(String(loaded.courtCount))
        setDayCourtNames(loaded.courtNames)
        setDayStartMin(loaded.startMin)
        setDayEndMin(loaded.endMin)
        setDaySlotMinutes(loaded.slotMinutes)
      } catch {
        // silent; admin can input and save
      }
    })()
  }, [])

  // load PIN from sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = sessionStorage.getItem('adminPin')
    if (p) setPin(p)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    sessionStorage.setItem('adminPin', pin)
  }, [pin])
  const [confirmTarget, setConfirmTarget] = useState<any | null>(null)
  const [hiddenDayKey, setHiddenDayKey] = useState<string | null>(null)
  const [isResetting, setIsResetting] = useState<boolean>(false)

  // Helper for UTC date key
  const dateKeyUTC = (d: any) => {
    try { return new Date(d).toISOString().slice(0,10) } catch { return '' }
  }

  // Data visible in table (apply hiddenDayKey immediately)
  const visibleData = useMemo(() => {
    const base = Array.isArray(data) ? data : []
    if (!hiddenDayKey) return base
    return base.filter((r: any) => dateKeyUTC(r.date) !== hiddenDayKey)
  }, [data, hiddenDayKey])

  const del = useMutation({
    mutationFn: async (id: string) => (await axios.delete(`/api/admin/force-delete/${id}`, { headers: { 'x-admin-pin': pin } })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['all-res'] }),
    onError: (e: any, id: string) => {
      // Rollback hidden state on error
      if (id) deletedRef.current.delete(id)
      qc.invalidateQueries({ queryKey: ['all-res'] })
      if (e?.response?.status === 401) {
        alert('管理PINを入力してください')
      } else {
        alert(e?.response?.data?.error ?? '削除に失敗しました')
      }
    },
  })

  // removed: legacy per-date court setting editor (now replaced by single-day controls)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-xl font-extrabold text-transparent">管理</h1>
        <div className="flex items-center gap-2">
          <input
            className="w-28 rounded border px-2 py-1 text-xs"
            type="password"
            placeholder="管理PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <div className="text-xs text-gray-500">{Array.isArray(visibleData) ? visibleData.length : 0} 件</div>
        </div>
      </div>

      {/* Single-day controls */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div className="text-sm font-medium text-gray-700">単日運用：当日設定とリセット</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded border px-2 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
              disabled={isResetting}
              onClick={async ()=>{
                if (!pin) { alert('管理PINを入力してください'); return }
                if (!confirm('過去（当日を含む）の予約をすべて削除します。よろしいですか？')) return
                setIsResetting(true)
                try {
                  // まずサーバから当日設定を取得して"今日"の基準日を合わせる
                  const dayCfg = await axios.get('/api/day', { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } }).then(r=>r.data).catch(()=>null)
                  const baseDateIso = (()=>{ try { return new Date(dayCfg?.date ?? lastLoadedRef.current?.date ?? dayDate).toISOString().slice(0,10) } catch { return dayDate } })()
                  // 明日(UTC)の00:00をcutoffにすることで、当日分を含めて削除（< cutoff）
                  const cutoffUtcStartOfTomorrow = new Date(baseDateIso + 'T00:00:00.000Z')
                  cutoffUtcStartOfTomorrow.setUTCDate(cutoffUtcStartOfTomorrow.getUTCDate() + 1)

                  const res = await axios.post('/api/admin/bulk-delete-past', { before: cutoffUtcStartOfTomorrow.toISOString() }, { headers: { 'x-admin-pin': pin } })

                  // リストを最新化
                  try {
                    await axios.get(`/api/reservations?_=${Date.now()}`, { headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' } })
                  } catch {}
                  await qc.refetchQueries({ queryKey: ['all-res'] })
                  alert(`削除件数: ${res.data?.deleted ?? 0}`)
                } catch (e: any) {
                  if (e?.response?.status === 401) alert('管理PINを入力してください')
                  else alert(e?.response?.data?.error ?? '削除に失敗しました')
                } finally { setIsResetting(false) }
              }}
            >{isResetting ? '削除中…' : '過去の全予約を削除'}</button>
          </div>
        </div>
        <div className="grid gap-3 p-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-xs text-gray-600">日付（YYYY-MM-DD）</label>
            <input className="w-48 rounded border px-2 py-1 text-sm" type="date" value={dayDate} onChange={(e)=>setDayDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-gray-600">コート数（1..8）</label>
            <input
              className="w-28 rounded border px-2 py-1 text-sm"
              type="number"
              inputMode="numeric"
              min={1}
              max={8}
              value={dayCourtCountInput}
              onChange={(e)=>{
                // allow temporary empty/partial values while typing
                setDayCourtCountInput(e.target.value)
              }}
              onBlur={(e)=>{
                const n = Number(e.target.value)
                const v = Number.isFinite(n) ? Math.max(1, Math.min(8, n)) : 1
                setDayCourtCount(v)
                setDayCourtCountInput(String(v))
                setDayCourtNames(prev=>{
                  const next=[...prev]
                  if (v>next.length) { while(next.length<v) next.push(String.fromCharCode(65 + next.length)) }
                  else if (v<next.length) { next.length=v }
                  return next
                })
              }}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-gray-600">コート名</label>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: dayCourtCount }).map((_,i)=> (
                <input key={i} className="rounded border px-2 py-1 text-sm" value={dayCourtNames[i] || ''} onChange={(e)=>setDayCourtNames(prev=>{ const n=[...prev]; n[i]=e.target.value; return n })} />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 items-center gap-2 text-sm">
            <label className="text-xs text-gray-600">開始</label>
            <input className="col-span-2 rounded border px-2 py-1" type="time" step={300} value={`${String(Math.floor(dayStartMin/60)).padStart(2,'0')}:${String(dayStartMin%60).padStart(2,'0')}`} onChange={(e)=>{ const [h,m]=e.target.value.split(':').map(Number); setDayStartMin(h*60+m) }} />
            <label className="text-xs text-gray-600">終了</label>
            <input className="col-span-2 rounded border px-2 py-1" type="time" step={300} value={`${String(Math.floor(dayEndMin/60)).padStart(2,'0')}:${String(dayEndMin%60).padStart(2,'0')}`} onChange={(e)=>{ const [h,m]=e.target.value.split(':').map(Number); setDayEndMin(h*60+m) }} />
            <label className="text-xs text-gray-600">枠（分）</label>
            <input className="col-span-2 rounded border px-2 py-1" type="number" min={5} step={5} value={daySlotMinutes} onChange={(e)=>setDaySlotMinutes(Math.max(5, Math.min(240, Number(e.target.value)||30)))} />
          </div>
          <div className="sm:col-span-2">
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              onClick={async ()=>{
                if (!pin) { alert('管理PINを入力してください'); return }
                // 軽いバリデーション
                const aligned = (n:number)=> n%5===0
                if (!aligned(dayStartMin) || !aligned(dayEndMin) || !aligned(daySlotMinutes)) { alert('開始・終了・枠（分）は5分単位で入力してください。'); return }
                if (dayStartMin >= dayEndMin) { alert('開始時刻は終了時刻より前にしてください。'); return }
                const range = dayEndMin - dayStartMin
                if (range % daySlotMinutes !== 0) { alert('（終了-開始）は枠（分）で割り切れる必要があります'); return }
                try {
                  // Finalize court count using the current input value (handles case when blur hasn't fired)
                  const nInput = Number(dayCourtCountInput)
                  const finalizedCount = Number.isFinite(nInput) ? Math.max(1, Math.min(8, nInput)) : dayCourtCount
                  // Sync local states to the finalized value
                  if (finalizedCount !== dayCourtCount) setDayCourtCount(finalizedCount)
                  if (String(finalizedCount) !== dayCourtCountInput) setDayCourtCountInput(String(finalizedCount))
                  const names = Array.from({ length: finalizedCount }, (_,i)=> dayCourtNames[i] || `Court${i+1}`)
                  await axios.put('/api/day', {
                    date: dayDate,
                    courtCount: finalizedCount,
                    courtNames: names,
                    startMin: dayStartMin,
                    endMin: dayEndMin,
                    slotMinutes: daySlotMinutes,
                  }, { headers: { 'x-admin-pin': pin } })
                  alert('当日設定を保存しました')
                  // snapshot last loaded as saved
                  lastLoadedRef.current = {
                    date: dayDate,
                    courtCount: finalizedCount,
                    courtNames: names,
                    startMin: dayStartMin,
                    endMin: dayEndMin,
                    slotMinutes: daySlotMinutes,
                  }
                  // Ensure names state length matches finalized count
                  setDayCourtNames(prev=>{ const next=[...prev]; if (finalizedCount>next.length) { while(next.length<finalizedCount) next.push(String.fromCharCode(65+next.length)) } else if (finalizedCount<next.length) { next.length=finalizedCount } return next })
                  // Proactively fetch fresh config to warm caches and update ETag
                  try { await axios.get(`/api/day?_=${Date.now()}`, { headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' } }) } catch {}
                  // Notify other tabs/pages to refetch day config
                  try { if (typeof window !== 'undefined') localStorage.setItem('dayCfgUpdated', String(Date.now())) } catch {}
                } catch (e:any) {
                  if (e?.response?.status === 401) alert('管理PINを入力してください')
                  else alert(e?.response?.data?.error ?? '保存に失敗しました')
                }
              }}
            >当日設定を保存</button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <div className="text-sm font-medium text-gray-700">予約一覧</div>
          <div className="flex items-center gap-2">
            <input className="w-56 rounded border px-3 py-1 text-sm" type="search" placeholder="予約検索（日時・コート・氏名など）" value={q} onChange={(e)=>setQ(e.target.value)} />
            <button type="button" className="rounded border px-2 py-1 text-sm hover:bg-gray-50" onClick={() => qc.invalidateQueries({ queryKey: ['all-res'] })}>更新</button>
          </div>
        </div>
        {(!visibleData || visibleData.length === 0) ? (
          <div className="p-6 text-center text-sm text-gray-500">予約はありません</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50/90 backdrop-blur">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium text-gray-600">日付</th>
                  <th className="px-3 py-2 font-medium text-gray-600">時間</th>
                  <th className="px-3 py-2 font-medium text-gray-600">コート</th>
                  <th className="px-3 py-2 font-medium text-gray-600">人数</th>
                  <th className="px-3 py-2 font-medium text-gray-600">氏名</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {(visibleData ?? []).filter((r: any) => {
                  if (!q.trim()) return true
                  const key = [
                    format(new Date(r.date), 'yyyy-MM-dd'),
                    `${fmt(r.startMin)} - ${fmt(r.endMin)}`,
                    `court ${r.courtId}`,
                    `${r.partySize}`,
                    ...(Array.isArray(r.playerNames) ? r.playerNames : []),
                  ]
                    .join(' ')
                    .toLowerCase()
                  return key.includes(q.trim().toLowerCase())
                }).map((r: any, i: number) => (
                  <tr key={r.id} className={i % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'}>
                    <td className="px-3 py-2 align-top">{format(new Date(r.date), 'yyyy-MM-dd')}</td>
                    <td className="px-3 py-2 align-top">{fmt(r.startMin)} - {fmt(r.endMin)}</td>
                    <td className="px-3 py-2 align-top">
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">Court {r.courtId}</span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">{r.partySize} 名</span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="overflow-x-auto max-w-[220px] sm:max-w-none">
                        <div className="inline-block min-w-max">
                          {(r.playerNames ?? []).map((name: string, idx: number) => (
                            <div key={idx} className="whitespace-nowrap">{name}</div>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <button
                        type="button"
                        className="rounded bg-red-600 px-3 py-1.5 text-white shadow hover:bg-red-700 disabled:opacity-60"
                        disabled={del.isPending}
                        onClick={() => setConfirmTarget(r)}
                      >
                        {del.isPending ? '削除中…' : '削除'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg">
            <div className="mb-3 text-lg font-semibold">本当に削除しますか？</div>
            <div className="mb-3 space-y-1 text-sm text-gray-700">
              <div>日付：{format(new Date(confirmTarget.date), 'yyyy-MM-dd')}</div>
              <div>時間：{fmt(confirmTarget.startMin)} - {fmt(confirmTarget.endMin)}</div>
              <div>コート：{confirmTarget.courtId}</div>
              <div>人数：{confirmTarget.partySize}</div>
              <div className="whitespace-pre-line">氏名：{(confirmTarget.playerNames ?? []).join('\n')}</div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded border px-3 py-2"
                onClick={() => setConfirmTarget(null)}
              >
                いいえ
              </button>
              <button
                type="button"
                className="flex-1 rounded bg-red-600 px-3 py-2 text-white disabled:opacity-60"
                disabled={del.isPending}
                onClick={async () => {
                  const id = confirmTarget.id
                  // Persistently hide this row until server confirms deletion
                  deletedRef.current.add(id)
                  // Optimistic remove from table for snappy UX
                  qc.setQueryData(['all-res'], (prev: any) => Array.isArray(prev) ? prev.filter((r: any) => r.id !== id) : prev)
                  try {
                    await del.mutateAsync(id)
                    // Strong sync: cache-busting fetch to avoid stale cached list re-appearing
                    const fresh = await axios.get(`/api/reservations?_=${Date.now()}`,
                      { headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' } })
                    const filtered = (Array.isArray(fresh.data) ? fresh.data : []).filter((r: any) => !deletedRef.current.has(r.id))
                    qc.setQueryData(['all-res'], filtered)
                  } finally {
                    setConfirmTarget(null)
                    await qc.refetchQueries({ queryKey: ['all-res'] })
                  }
                }}
              >
                はい
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
