// A small in-memory stand-in for the Supabase client, used only in demo mode (VYRA_DATA_MODE=demo).
// It supports exactly what the API routes use: from().select/insert/update/delete with eq/neq/in/gte/lte,
// order, limit, single/maybeSingle, and the embedded relations in DISPATCH_SELECT. Server-side only.
import { randomUUID } from 'node:crypto'
import { getStore } from './db'
import { buildOps } from './db/demoOpsSeed'
import { largeDemoDataset, useLargeDemoDataset } from './db/largeSeed'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Result = { data: any; error: { message: string; code?: string } | null } // eslint-disable-line @typescript-eslint/no-explicit-any

const g = globalThis as unknown as { __vyraDemoTables?: Record<string, Row[]> }

export async function demoTables() {
  return tables()
}

async function tables() {
  if (!g.__vyraDemoTables) {
    if (useLargeDemoDataset()) {
      const d = largeDemoDataset()
      const { accounts: _a, report_events: _e, reports: _r, blocked_roads: _b, ...ops } = d // eslint-disable-line @typescript-eslint/no-unused-vars
      g.__vyraDemoTables = { ...ops, emergency_reports: d.reports.map((r) => ({ ...r })) } as unknown as Record<string, Row[]>
      return g.__vyraDemoTables
    }
    const reports = await getStore().listReports({})
    // Seeding missions needs coordinates; reports sent with only a typed landmark are skipped here.
    const placed = reports.filter((r) => r.location_lat != null && r.location_lng != null) as Parameters<typeof buildOps>[0]
    g.__vyraDemoTables = buildOps(placed) as unknown as Record<string, Row[]>
  }
  return g.__vyraDemoTables
}

// Embedded relations: name -> [table, localKey, many?]
const RELATIONS: Record<string, Record<string, { table: string; key: string; many?: boolean; foreign?: string }>> = {
  dispatches: {
    emergency_reports: { table: 'emergency_reports', key: 'report_id' },
    rescue_teams: { table: 'rescue_teams', key: 'team_id' },
    dispatch_resources: { table: 'dispatch_resources', key: 'id', many: true, foreign: 'dispatch_id' },
  },
  dispatch_resources: { resources: { table: 'resources', key: 'resource_id' } },
  resources: { rescue_teams: { table: 'rescue_teams', key: 'team_id' } },
}

const fail = (message: string, code?: string): Result => ({ data: null, error: { message, code } })

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: Row | Row[] | null = null
  private filters: ((r: Row) => boolean)[] = []
  private sort: { col: string; asc: boolean } | null = null
  private max: number | null = null
  private cols = '*'
  private one: 'single' | 'maybe' | null = null
  private returning = false

  constructor(private table: string) {}

  select(cols = '*') { this.cols = cols; if (this.op !== 'select') this.returning = true; return this }
  insert(p: Row | Row[]) { this.op = 'insert'; this.payload = p; return this }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  delete() { this.op = 'delete'; return this }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this }
  in(c: string, v: unknown[]) { this.filters.push((r) => v.includes(r[c])); return this }
  gte(c: string, v: number) { this.filters.push((r) => Number(r[c]) >= v); return this }
  lte(c: string, v: number) { this.filters.push((r) => Number(r[c]) <= v); return this }
  order(col: string, o?: { ascending?: boolean }) { this.sort = { col, asc: o?.ascending !== false }; return this }
  limit(n: number) { this.max = n; return this }
  single() { this.one = 'single'; return this }
  maybeSingle() { this.one = 'maybe'; return this }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.run().then(ok, no)
  }

  private async rows(table: string): Promise<Row[]> {
    if (table === 'emergency_reports') return (await getStore().listReports({})) as unknown as Row[]
    return (await tables())[table] ?? []
  }

  private async embed(rows: Row[], table: string, cols: string): Promise<Row[]> {
    const rels = RELATIONS[table]
    if (!rels) return rows
    const wanted = Object.entries(rels).filter(([name]) => cols.includes(`${name}(`))
    if (!wanted.length) return rows
    const out: Row[] = []
    for (const row of rows) {
      const copy: Row = { ...row }
      for (const [name, rel] of wanted) {
        const pool = await this.rows(rel.table)
        if (rel.many) {
          let kids = pool.filter((k) => k[rel.foreign!] === row[rel.key])
          kids = await this.embed(kids, rel.table, cols)
          copy[name] = kids
        } else copy[name] = pool.find((p) => p.id === row[rel.key]) ?? null
      }
      out.push(copy)
    }
    return out
  }

  private async run(): Promise<Result> {
    try {
      const all = await this.rows(this.table)
      let matched = all.filter((r) => this.filters.every((f) => f(r)))

      if (this.op === 'insert') {
        if (this.table === 'emergency_reports') return fail('Insert reports through the report service in demo mode')
        const now = new Date().toISOString()
        const made = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((p) => ({ id: randomUUID(), created_at: now, updated_at: now, ...p }))
        all.push(...made)
        matched = made
      } else if (this.op === 'update') {
        if (this.table === 'emergency_reports') {
          const out: Row[] = []
          for (const r of matched) out.push((await getStore().updateReport(r.id, this.payload as never)) as unknown as Row)
          matched = out
        } else {
          for (const r of matched) Object.assign(r, this.payload, { updated_at: new Date().toISOString() })
        }
      } else if (this.op === 'delete') {
        if (this.table === 'emergency_reports') return fail('Reports cannot be deleted in demo mode')
        for (const r of matched) all.splice(all.indexOf(r), 1)
        // Mirror ON DELETE CASCADE for the tables that hang off the deleted row.
        if (this.table === 'dispatches') {
          const kids = (await tables()).dispatch_resources
          const ids = new Set(matched.map((m) => m.id))
          for (let i = kids.length - 1; i >= 0; i--) if (ids.has(kids[i].dispatch_id)) kids.splice(i, 1)
        }
        return { data: null, error: null }
      }

      if (this.op !== 'select' && !this.returning) return { data: null, error: null }

      if (this.sort) {
        const { col, asc } = this.sort
        matched = [...matched].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1))
      }
      if (this.max != null) matched = matched.slice(0, this.max)
      const data = (await this.embed(matched, this.table, this.cols)).map((r) => structuredClone(r))

      if (this.one) {
        if (data.length === 1) return { data: data[0], error: null }
        if (this.one === 'maybe' && data.length === 0) return { data: null, error: null }
        return fail('JSON object requested, multiple (or no) rows returned', 'PGRST116')
      }
      return { data, error: null }
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Demo database error')
    }
  }
}

export const demoClient = { from: (table: string) => new Query(table) }
