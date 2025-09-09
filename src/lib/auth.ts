import { getSupabaseServer } from './supabase'
import { prisma } from './prisma'

export async function requireUser() {
  const supabase = getSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  // ensure local user row exists
  const dbUser = await prisma.user.upsert({
    where: { email: user.email! },
    create: { email: user.email! },
    update: {},
  })
  return dbUser
}

export async function requireAdmin() {
  const u = await requireUser()
  if (u.role !== 'ADMIN') throw new Error('Forbidden')
  return u
}
