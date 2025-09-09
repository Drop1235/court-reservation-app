import { prisma } from '../src/lib/prisma'

async function main() {
  // Courts 1..8
  for (let i = 1; i <= 8; i++) {
    await prisma.court.upsert({ where: { name: `Court${i}` }, create: { name: `Court${i}` }, update: {} })
  }

  // Users by email (roles)
  await prisma.user.upsert({ where: { email: 'admin@example.com' }, create: { email: 'admin@example.com', role: 'ADMIN' }, update: {} })
  await prisma.user.upsert({ where: { email: 'user@example.com' }, create: { email: 'user@example.com', role: 'USER' }, update: {} })

  console.log('Seed completed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
