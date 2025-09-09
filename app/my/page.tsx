"use client"
import axios from 'axios'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'

type Reservation = {
  id: string
  courtId: number
  date: string
  startMin: number
  endMin: number
  partySize: number
  playerNames: string[]
}

export default function MyPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'future' | 'past'>('future')

  const { data } = useQuery({
    queryKey: ['my-reservations'],
    queryFn: async () => (await axios.get<Reservation[]>('/api/reservations')).data,
  })

  const now = new Date()
  const items = useMemo(() => {
    const arr = (data ?? []) as Reservation[]
    return arr
      .map((r) => ({
        ...r,
        dt: new Date(r.date),
      }))
      .filter((r) => (tab === 'future' ? r.dt >= now : r.dt < now))
      .sort((a, b) => a.dt.getTime() - b.dt.getTime())
  }, [data, tab])

  const del = useMutation({
    mutationFn: async (id: string) => (await axios.delete(`/api/reservations/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-reservations'] }),
  })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">マイ予約</h1>
      <div className="flex gap-2">
        <button className={`flex-1 rounded border px-3 py-2 ${tab === 'future' ? 'bg-blue-600 text-white' : ''}`} onClick={() => setTab('future')}>
          これから
        </button>
        <button className={`flex-1 rounded border px-3 py-2 ${tab === 'past' ? 'bg-blue-600 text-white' : ''}`} onClick={() => setTab('past')}>
          過去
        </button>
      </div>
      <ul className="space-y-2">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded border p-3">
            <div>
              <div className="font-medium">
                {format(new Date(r.date), 'yyyy-MM-dd')} コート {r.courtId}
              </div>
              <div className="text-sm">
                {String(r.startMin / 60).padStart(2, '0')}:00 - {String(r.endMin / 60).padStart(2, '0')}:00 ・ 人数 {r.partySize} ・ 氏名 {(r.playerNames ?? []).join('、')}
              </div>
            </div>
            <button className="rounded bg-red-600 px-3 py-2 text-white" onClick={() => del.mutate(r.id)}>
              取消
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
