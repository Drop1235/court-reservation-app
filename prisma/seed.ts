import { prisma } from '../src/lib/prisma'

async function main() {
  // Courts 1..21
  for (let i = 1; i <= 21; i++) {
    await prisma.court.upsert({ where: { name: `Court${i}` }, create: { name: `Court${i}` }, update: {} })
  }

  // Users by email (roles)
  await prisma.user.upsert({ where: { email: 'admin@example.com' }, create: { email: 'admin@example.com', role: 'ADMIN' }, update: {} })
  await prisma.user.upsert({ where: { email: 'user@example.com' }, create: { email: 'user@example.com', role: 'USER' }, update: {} })

  // Admin PIN (persisted); fall back to env or default
  try {
    const anyPrisma: any = prisma as any
    if (anyPrisma && anyPrisma.adminConfig && typeof anyPrisma.adminConfig.upsert === 'function') {
      const initPin = process.env.ADMIN_PIN || '0000'
      await anyPrisma.adminConfig.upsert({
        where: { id: 'singleton' },
        update: { adminPin: initPin },
        create: { id: 'singleton', adminPin: initPin },
      })
    }
  } catch {}

  console.log('Seed completed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
