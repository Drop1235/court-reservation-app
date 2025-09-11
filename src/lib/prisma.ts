import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma?: PrismaClient }

// Netlify (pgBouncer) 対応: 念のため実行時にも prepared statements を無効化
if (process.env.PRISMA_DISABLE_PREPARED_STATEMENTS !== 'true') {
  process.env.PRISMA_DISABLE_PREPARED_STATEMENTS = 'true'
}

// DATABASE_URL に pgbouncer=true / sslmode=require が無い場合は付与（Runtime hardening）
try {
  const url = process.env.DATABASE_URL || ''
  if (url && (!url.includes('pgbouncer=true') || !url.includes('sslmode=require'))) {
    const hasQuery = url.includes('?')
    const needsPgBouncer = !url.includes('pgbouncer=true')
    const needsSSL = !url.includes('sslmode=require')
    const params = [needsPgBouncer ? 'pgbouncer=true' : null, needsSSL ? 'sslmode=require' : null].filter(Boolean).join('&')
    process.env.DATABASE_URL = url + (hasQuery ? '&' : '?') + params
  }
} catch (_) {
  // noop
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
