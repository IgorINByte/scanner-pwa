import { openDB, type DBSchema } from 'idb'
import type { ExportFormat } from '../types'

export const HISTORY_LIMIT = 20

export interface StoredFile {
  name: string
  type: string
  blob: Blob
}

export interface ScanRecord {
  id: string
  name: string
  createdAt: number
  pageCount: number
  format: ExportFormat
  thumb: Blob
  files: StoredFile[]
  size: number
}

interface ScannerDB extends DBSchema {
  scans: { key: string; value: ScanRecord; indexes: { createdAt: number } }
}

const dbPromise = openDB<ScannerDB>('scanner', 1, {
  upgrade(db) {
    const store = db.createObjectStore('scans', { keyPath: 'id' })
    store.createIndex('createdAt', 'createdAt')
  },
})

export async function listScans(): Promise<ScanRecord[]> {
  const all = await (await dbPromise).getAllFromIndex('scans', 'createdAt')
  return all.reverse()
}

/** Saves a scan and prunes history down to the newest HISTORY_LIMIT entries. */
export async function saveScan(record: ScanRecord) {
  const db = await dbPromise
  const tx = db.transaction('scans', 'readwrite')
  await tx.store.put(record)
  const keys = await tx.store.index('createdAt').getAllKeys()
  const excess = keys.length - HISTORY_LIMIT
  for (let i = 0; i < excess; i++) await tx.store.delete(keys[i])
  await tx.done
}

export async function deleteScan(id: string) {
  await (await dbPromise).delete('scans', id)
}

export const toFiles = (r: ScanRecord) => r.files.map((f) => new File([f.blob], f.name, { type: f.type }))
