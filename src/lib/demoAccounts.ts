// Demo-mode sign-in accounts. They exist only in the in-memory demo database and grant nothing
// outside it. The shared password is public on purpose: this is a demo, not a real login.
export type DemoRole = 'citizen' | 'responder' | 'admin'

export interface DemoAccount {
  id: string
  email: string
  full_name: string
  role: DemoRole
  blurb: string
}

export const DEMO_PASSWORD = 'VYRA-demo-1'

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: '90000000-0000-4000-8000-000000000001', email: 'admin@demo.vyra', full_name: 'Amina Farooqui', role: 'admin', blurb: 'Manages teams, supplies and people' },
  { id: '90000000-0000-4000-8000-000000000002', email: 'dispatcher@demo.vyra', full_name: 'Hamza Siddiqui', role: 'responder', blurb: 'Dispatcher on the night desk' },
  { id: '90000000-0000-4000-8000-000000000003', email: 'fieldlead@demo.vyra', full_name: 'Sana Qureshi', role: 'responder', blurb: 'Boat team field lead' },
  { id: '90000000-0000-4000-8000-000000000004', email: 'logistics@demo.vyra', full_name: 'Waleed Khokhar', role: 'responder', blurb: 'Supplies and logistics' },
  { id: '90000000-0000-4000-8000-000000000005', email: 'citizen@demo.vyra', full_name: 'Bilal Ahmed', role: 'citizen', blurb: 'Resident who reports an emergency' },
  { id: '90000000-0000-4000-8000-000000000006', email: 'neighbour@demo.vyra', full_name: 'Nida Hussain', role: 'citizen', blurb: 'Resident, volunteers on weekends' },
]

export interface SessionUser {
  id: string
  email: string
  full_name: string
  role: DemoRole
  demo: boolean
}

export const isHome = (role: string) => (role === 'responder' || role === 'admin' ? '/dashboard' : '/')
