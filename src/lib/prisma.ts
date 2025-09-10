import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma?: PrismaClient }

// Netlify (pgBouncer) 対応: 念のため実行時にも prepared statements を無効化
if (process.env.PRISMA_DISABLE_PREPARED_STATEMENTS !== 'true') {
  process.env.PRISMA_DISABLE_PREPARED_STATEMENTS = 'true'
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
