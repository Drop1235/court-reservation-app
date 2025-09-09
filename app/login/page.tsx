"use client"
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useState } from 'react'

export default function LoginPage() {
  const supabase = createClientComponentClient()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function signIn() {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.origin + '/reserve' : undefined } })
    if (!error) setSent(true)
    else alert(error.message)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Login</h1>
      <input
        className="w-full rounded border px-3 py-2"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="w-full rounded bg-blue-600 px-3 py-2 text-white" onClick={signIn}>
        Send Magic Link
      </button>
      {sent && <p className="text-sm text-green-600">Check your email for the magic link.</p>}
    </div>
  )
}
