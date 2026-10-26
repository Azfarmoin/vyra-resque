// Demo sign-in is "who you say you are": the browser sends an email (x-demo-user / x-demo-admin) or `demo:<id>` and the server
// believes it, because the accounts, their emails and the shared password are public on purpose (see demoAccounts.ts). That is
// fine for a laptop demo and is a complete role-escalation hole on the internet: anyone can send `x-demo-admin: admin@demo.vyra`.
//
// VYRA falls back to demo mode whenever Supabase is not configured, so a production deployment with a missing or mistyped
// environment variable would silently become an open demo. This guard makes that fail closed: in production, demo identities are
// ignored unless someone explicitly sets VYRA_ALLOW_DEMO_IN_PRODUCTION=true (for a public, fake-data showcase only).
export function demoAuthAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.VYRA_ALLOW_DEMO_IN_PRODUCTION === 'true'
}
