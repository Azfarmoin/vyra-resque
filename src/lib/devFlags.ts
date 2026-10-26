// Testing switches. Both are OFF unless the environment variable is set to "true".
//
//  VYRA_DISABLE_RATE_LIMITS=true       every limiter (route analysis, flood, satellite, photo analysis, support form) lets requests through.
//  NEXT_PUBLIC_VYRA_OPEN_ACCESS=true   no sign-in: every visitor acts as the demo administrator.
//
// OPEN_ACCESS only works in demo / in-memory data mode (VYRA_DATA_MODE=demo). With a real Supabase project the database's
// own row-level security cannot be bypassed from the app, so the switch is ignored there and normal sign-in applies.
// Never enable either switch on a deployment that other people can reach.
export const rateLimitsDisabled = (): boolean => process.env.VYRA_DISABLE_RATE_LIMITS === 'true'
export const openAccessRequested = (): boolean => process.env.NEXT_PUBLIC_VYRA_OPEN_ACCESS === 'true'
