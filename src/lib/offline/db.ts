import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { LocalAttachment, LocalReport } from './types'
import type { DeliveryRecord } from '../delivery/types'
import { ANON } from './types'

interface VyraDB extends DBSchema {
  reports: { key: string; value: LocalReport; indexes: { owner: string; status: string } }
  attachments: { key: string; value: LocalAttachment; indexes: { report_id: string } }
  meta: { key: string; value: { key: string; value: unknown } }
  // Version 3: how each report is being delivered over radio / SMS / Bluetooth / internet (see src/lib/delivery).
  delivery: { key: string; value: DeliveryRecord }
}

export const DB_NAME = 'vyra-offline'
export const DB_VERSION = 3

let dbPromise: Promise<IDBPDatabase<VyraDB>> | null = null

export const isIndexedDbAvailable = () => typeof indexedDB !== 'undefined'

export function getDb(): Promise<IDBPDatabase<VyraDB>> {
  if (!isIndexedDbAvailable()) return Promise.reject(new Error('IndexedDB is not available in this browser'))
  if (!dbPromise) {
    dbPromise = openDB<VyraDB>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        // Each block only runs for databases older than the version that introduced it, so an existing
        // version-2 database (with unsent reports in it) is upgraded in place and never recreated.
        if (oldVersion < 2) {
        const reports = db.createObjectStore('reports', { keyPath: 'client_id' })
        reports.createIndex('owner', 'owner')
        reports.createIndex('status', 'status')
        const attachments = db.createObjectStore('attachments', { keyPath: 'id' })
        attachments.createIndex('report_id', 'report_id')
        db.createObjectStore('meta', { keyPath: 'key' })

        // Version 1 kept a simple `report_queue`. Carry unsent items over instead of dropping them.
        if (oldVersion === 1 && db.objectStoreNames.contains('report_queue' as never)) {
          const legacy = tx.objectStore('report_queue' as never) as unknown as { getAll(): Promise<LegacyEntry[]> }
          for (const old of await legacy.getAll()) {
            if (old.status === 'synced') continue
            const now = new Date().toISOString()
            const payload = { ...old.payload, client_id: old.client_id, location_source: 'manual' }
            await reports.put({
              client_id: old.client_id,
              owner: (old.payload?.reporter_id as string | null) || ANON,
              status: 'saved_locally',
              form: {},
              payload,
              step: 0,
              created_at: old.created_at || now,
              updated_at: now,
              queued_at: old.created_at || now,
              attempts: 0,
              next_attempt_at: null,
              last_error: null,
              server_id: null,
              server_status: null,
              synced_at: null,
              duplicate: false,
              created_offline: Boolean(old.created_offline),
            })
          }
          db.deleteObjectStore('report_queue' as never)
        }
        }
        if (oldVersion < 3 && !db.objectStoreNames.contains('delivery')) {
          db.createObjectStore('delivery', { keyPath: 'client_id' })
        }
      },
      terminated() {
        dbPromise = null
      },
    })
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

interface LegacyEntry {
  client_id: string
  status: string
  payload: Record<string, unknown>
  created_at: string
  created_offline?: boolean
}

/** Tests only: close the connection so a "browser restart" re-opens the same database. */
export async function closeDbForTests() {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
}
