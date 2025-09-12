"use client"
import axios from 'axios'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'

const fmt = (min: number) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function AdminPage() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['all-res'], queryFn: async () => (await axios.get('/api/reservations')).data })
  const [q, setQ] = useState('')
  const [pin, setPin] = useState('')
  const [settingDate, setSettingDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [bulkCutoff, setBulkCutoff] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'))
  const [settingCount, setSettingCount] = useState<number>(4)
  const [settingNames, setSettingNames] = useState<string[]>(['Court1', 'Court2', 'Court3', 'Court4'])
  const [startMin, setStartMin] = useState<number>(9 * 60)
  const [endMin, setEndMin] = useState<number>(21 * 60)
  const [slotMinutes, setSlotMinutes] = useState<number>(30)

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

  const del = useMutation({
    mutationFn: async (id: string) => (await axios.delete(`/api/admin/force-delete/${id}`, { headers: { 'x-admin-pin': pin } })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['all-res'] }),
    onError: (e: any) => {
      if (e?.response?.status === 401) {
        alert('管理PINを入力してください')
      } else {
        alert(e?.response?.data?.error ?? '削除に失敗しました')
      }
    },
  })

  // load current court setting for date
  const loadSetting = useMemo(
    () => async () => {
      try {
        const res = await axios.get('/api/admin/court-setting', { params: { date: settingDate } })
        const s = res.data
        if (!s) {
          setSettingCount(4)
          setSettingNames(['Court1', 'Court2', 'Court3', 'Court4'])
          setStartMin(9 * 60)
          setEndMin(21 * 60)
          setSlotMinutes(30)
        } else {
          setSettingCount(s.courtCount)
          setSettingNames(s.courtNames)
          setStartMin(s.startMin ?? 9 * 60)
          setEndMin(s.endMin ?? 21 * 60)
          setSlotMinutes(s.slotMinutes ?? 30)
        }
      } catch (e) {
        alert('コート設定の読込に失敗しました')
      }
    },
    [settingDate]
  )

  useEffect(() => {
    loadSetting()
  }, [loadSetting])

  const saveSetting = async () => {
    try {
      const names = Array.from({ length: settingCount }, (_, i) => settingNames[i] || `Court${i + 1}`)
      // Client-side validation for time range and slot minutes
      const aligned = (n: number) => n % 5 === 0
      if (!aligned(startMin) || !aligned(endMin) || !aligned(slotMinutes)) {
        alert('開始・終了・枠（分）は5分単位で入力してください。')
        return
      }
      if (startMin >= endMin) {
        alert('開始時刻は終了時刻より前にしてください。')
        return
      }
      const range = endMin - startMin
      if (range % slotMinutes !== 0) {
        // 提案: 指定レンジを割り切れる候補を提示
        const candidates = Array.from({ length: 240 / 5 }, (_, i) => (i + 1) * 5).filter((m) => m >= 5 && m <= 240 && range % m === 0)
        const suggestion = candidates.length > 0 ? `（例: ${candidates.filter((m)=>[10,15,20,30,40,45,60,90,120].includes(m)).join(', ') || candidates.slice(0,6).join(', ')}）` : ''
        alert(`「終了-開始」が枠（分）で割り切れる必要があります。
範囲: ${Math.floor(range/60)}時間${range%60}分 / 現在の枠: ${slotMinutes}分 は不正です。
割り切れる枠の候補 ${suggestion}`)
        return
      }
      await axios.post(
        '/api/admin/court-setting',
        { date: settingDate, courtCount: settingCount, courtNames: names, startMin, endMin, slotMinutes },
        { headers: { 'x-admin-pin': pin } }
      )
      alert('保存しました')
      qc.invalidateQueries({ queryKey: ['reservations'] })
    } catch (e: any) {
      if (e?.response?.status === 401) {
        alert('管理PINを入力してください')
      } else {
        alert(e?.response?.data?.error ?? '保存に失敗しました')
      }
    }
  }

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
          <div className="hidden sm:flex items-center gap-1 text-xs">
            <label className="text-gray-600">過去予約一括削除の基準日</label>
            <input type="date" className="rounded border px-2 py-1" value={bulkCutoff} onChange={(e)=>setBulkCutoff(e.target.value)} />
            <button
              type="button"
              className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-700"
              onClick={async ()=>{
                if (!confirm(`${bulkCutoff} より前の予約をすべて削除します。よろしいですか？`)) return
                try {
                  const res = await axios.post('/api/admin/bulk-delete-past', { before: bulkCutoff + 'T00:00:00.000Z' }, { headers: { 'x-admin-pin': pin } })
                  alert(`削除件数: ${res.data.deleted}`)
                  qc.invalidateQueries({ queryKey: ['all-res'] })
                } catch (e: any) {
                  if (e?.response?.status === 401) alert('管理PINを入力してください')
                  else alert(e?.response?.data?.error ?? '一括削除に失敗しました')
                }
              }}
            >過去予約を一括削除</button>
          </div>
          <div className="text-xs text-gray-500">{data?.length ?? 0} 件</div>
        </div>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <div className="text-sm text-gray-600">設定</div>
          <div className="flex items-center gap-2">
            <input
              className="w-56 rounded border px-3 py-1 text-sm"
              type="search"
              placeholder="予約検索（日時・コート・氏名など）"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button
              type="button"
              className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
              onClick={() => qc.invalidateQueries({ queryKey: ['all-res'] })}
            >
              更新
            </button>
          </div>
        </div>
        <div className="grid gap-4 border-b p-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">コート設定（管理者のみ）</div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600">日付</label>
                <input className="rounded border px-2 py-1 text-sm" type="date" value={settingDate} onChange={(e) => setSettingDate(e.target.value)} />
                <button type="button" className="rounded border px-2 py-1 text-sm hover:bg-gray-50" onClick={loadSetting}>読込</button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600">コート数</label>
                <input
                  className="w-20 rounded border px-2 py-1 text-sm"
                  type="number"
                  min={1}
                  max={8}
                  value={settingCount}
                  onChange={(e) => setSettingCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
                />
                <button type="button" className="rounded border px-2 py-1 text-sm hover:bg-gray-50" onClick={() => setSettingNames((prev) => {
                  const next = [...prev]
                  if (settingCount > next.length) { while (next.length < settingCount) next.push(`Court${next.length + 1}`) }
                  else if (settingCount < next.length) { next.length = settingCount }
                  return next
                })}>反映</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: settingCount }).map((_, i) => (
                  <input
                    key={i}
                    className="rounded border px-2 py-1 text-sm"
                    placeholder={`Court${i + 1}`}
                    value={settingNames[i] || ''}
                    onChange={(e) => setSettingNames((prev) => { const n = [...prev]; n[i] = e.target.value; return n })}
                  />
                ))}
              </div>
              <div>
                <button type="button" className="mt-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700" onClick={saveSetting}>保存</button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">時間設定</div>
              <div className="grid grid-cols-3 items-center gap-2 text-sm">
                <label className="text-xs text-gray-600">開始</label>
                <input
                  className="col-span-2 rounded border px-2 py-1"
                  type="time"
                  step={300}
                  value={`${String(Math.floor(startMin/60)).padStart(2,'0')}:${String(startMin%60).padStart(2,'0')}`}
                  onChange={(e) => {
                    const [h,m] = e.target.value.split(':').map(Number)
                    setStartMin(h*60+m)
                  }}
                />
                <label className="text-xs text-gray-600">終了</label>
                <input
                  className="col-span-2 rounded border px-2 py-1"
                  type="time"
                  step={300}
                  value={`${String(Math.floor(endMin/60)).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}`}
                  onChange={(e) => {
                    const [h,m] = e.target.value.split(':').map(Number)
                    setEndMin(h*60+m)
                  }}
                />
                <label className="text-xs text-gray-600">枠（分）</label>
                <input
                  className="col-span-2 rounded border px-2 py-1"
                  type="number"
                  min={5}
                  step={5}
                  value={slotMinutes}
                  onChange={(e) => setSlotMinutes(Math.max(5, Math.min(240, Number(e.target.value)||30)))}
                />
              </div>
              <p className="text-xs text-gray-500">5分単位。開始＜終了、かつ（終了-開始）は枠分数で割り切れるようにしてください。</p>
            </div>
        </div>
        {(!data || data.length === 0) ? (
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
                {(data ?? []).filter((r: any) => {
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
                    <td className="px-3 py-2 whitespace-pre-line align-top">{(r.playerNames ?? []).join('\n')}</td>
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
                  setConfirmTarget(null)
                  del.mutate(id)
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
