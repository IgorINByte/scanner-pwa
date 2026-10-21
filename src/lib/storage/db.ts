// IndexedDB schema. Version 1 only had the `scans` export history; version 2 adds
// documents, folders, binary blobs and saved signatures. Upgrades never drop data.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ExportFormat, Folder, ScanDocument, DocumentKind } from '../../types'

export interface StoredFile {
  name: string
  type: string
  blob: Blob
}

/** An exported file set (v1 "history"). */
export interface ExportRecord {
  id: string
  name: string
  createdAt: number
  pageCount: number
  format: ExportFormat | 'txt' | 'docx'
  thumb: Blob
  files: StoredFile[]
  size: number
}

export interface DocumentRecord extends ScanDocument {
  thumb: Blob | null
  pageCount: number
  kind: DocumentKind
  /** Lower-cased name + OCR text, for full-text search. */
  searchText: string
}

export interface BlobRecord {
  id: string
  docId: string
  blob: Blob
  createdAt: number
}

export interface SignatureRecord {
  id: string
  /** PNG data URL (small, trimmed). */
  src: string
  createdAt: number
}

interface ScannerDB extends DBSchema {
  scans: { key: string; value: ExportRecord; indexes: { createdAt: number } }
  documents: { key: string; value: DocumentRecord; indexes: { updatedAt: number; folderId: string } }
  folders: { key: string; value: Folder }
  blobs: { key: string; value: BlobRecord; indexes: { docId: string } }
  signatures: { key: string; value: SignatureRecord }
}

export type DB = IDBPDatabase<ScannerDB>

let dbPromise: Promise<DB> | null = null

export function getDb(): Promise<DB> {
  dbPromise ??= openDB<ScannerDB>('scanner', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('scans', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
      }
      if (oldVersion < 2) {
        const docs = db.createObjectStore('documents', { keyPath: 'id' })
        docs.createIndex('updatedAt', 'updatedAt')
        docs.createIndex('folderId', 'folderId')
        db.createObjectStore('folders', { keyPath: 'id' })
        db.createObjectStore('blobs', { keyPath: 'id' }).createIndex('docId', 'docId')
        db.createObjectStore('signatures', { keyPath: 'id' })
      }
    },
    blocking() {
      // A newer version of the app was opened in another tab.
      dbPromise?.then((db) => db.close())
      dbPromise = null
    },
  })
  return dbPromise
}
