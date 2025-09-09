import type { Metadata } from 'next'
import './globals.css'
import { QueryClientProviderWrapper } from '@/components/providers/query-client-provider'

export const metadata: Metadata = {
  title: 'Court Reservation',
  description: 'Tennis Court Reservation Prototype',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <QueryClientProviderWrapper>
          <div className="mx-auto max-w-md p-4">{children}</div>
        </QueryClientProviderWrapper>
      </body>
    </html>
  )
}
