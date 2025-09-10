export function isFiveMinuteAligned(min: number) {
  return min % 5 === 0
}

export function minutes(h: number, m: number) {
  return h * 60 + m
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd)
}

export function oneHourSlotsForDay() {
  // 0:00..24:00 in 60-min
  return Array.from({ length: 24 }, (_, i) => ({ start: i * 60, end: (i + 1) * 60 }))
}

export function halfHourSlots9to21() {
  // 09:00..21:00 in 30-min increments (exclusive end)
  const startHour = 9
  const endHour = 21
  const slots: { start: number; end: number }[] = []
  for (let h = startHour; h < endHour; h++) {
    slots.push({ start: h * 60, end: h * 60 + 30 })
    slots.push({ start: h * 60 + 30, end: (h + 1) * 60 })
  }
  return slots
}

export function makeSlots(startMin: number, endMin: number, slotMinutes: number) {
  // Generate [start,end) slots in `slotMinutes` increments
  const slots: { start: number; end: number }[] = []
  for (let s = startMin; s + slotMinutes <= endMin; s += slotMinutes) {
    slots.push({ start: s, end: s + slotMinutes })
  }
  return slots
}

export const DEFAULT_START_MIN = 9 * 60
export const DEFAULT_END_MIN = 21 * 60
export const DEFAULT_SLOT_MINUTES = 30

export function assertServerReservationValidity(startMin: number, endMin: number, partySize: number) {
  if (!isFiveMinuteAligned(startMin) || !isFiveMinuteAligned(endMin)) {
    throw new Error('Time must be aligned to 5-minute increments')
  }
  if (startMin >= endMin) throw new Error('Start must be before end')
  if (partySize < 1 || partySize > 4) throw new Error('partySize must be 1..4')
}
