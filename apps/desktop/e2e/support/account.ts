export interface TestAccount {
  email: string
  password: string
}

export const createTestAccount = (name: string): TestAccount => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return {
    email: `yannr-e2e-${name}-${suffix}@example.com`,
    password: process.env.YANNR_E2E_PASSWORD ?? "Password123!",
  }
}
