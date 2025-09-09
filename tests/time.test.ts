import { assertServerReservationValidity, overlaps } from '@/src/lib/time'

it('validates time and party size', () => {
  expect(() => assertServerReservationValidity(5, 10, 0)).toThrow()
  expect(() => assertServerReservationValidity(6, 10, 1)).toThrow()
  expect(() => assertServerReservationValidity(10, 5, 1)).toThrow()
  expect(() => assertServerReservationValidity(10, 20, 5)).toThrow()
  expect(() => assertServerReservationValidity(10, 20, 1)).not.toThrow()
})

it('detects overlaps', () => {
  expect(overlaps(0, 60, 60, 120)).toBe(false)
  expect(overlaps(0, 60, 59, 120)).toBe(true)
  expect(overlaps(30, 90, 0, 40)).toBe(true)
})
