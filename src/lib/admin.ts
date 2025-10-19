import { prisma } from '@/src/lib/prisma'

export async function getExpectedAdminPin(): Promise<string> {
  try {
    const anyPrisma: any = prisma as any
    const has = anyPrisma && anyPrisma.adminConfig && typeof anyPrisma.adminConfig.findFirst === 'function'
    if (has) {
      const row = await anyPrisma.adminConfig.findFirst({ orderBy: { updatedAt: 'desc' } })
      if (row && typeof row.adminPin === 'string' && row.adminPin.length > 0) return row.adminPin
    }
  } catch {}
  return process.env.ADMIN_PIN || ''
}

export async function setAdminPin(newPin: string): Promise<boolean> {
  try {
    const anyPrisma: any = prisma as any
    const has = anyPrisma && anyPrisma.adminConfig && typeof anyPrisma.adminConfig.upsert === 'function'
    if (!has) return false
    await anyPrisma.adminConfig.upsert({
      where: { id: 'singleton' },
      update: { adminPin: newPin },
      create: { id: 'singleton', adminPin: newPin },
    })
    return true
  } catch {
    return false
  }
}
