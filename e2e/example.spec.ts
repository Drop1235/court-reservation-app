import { test, expect } from '@playwright/test'

test('home redirects to reserve', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/.*reserve/)
})
