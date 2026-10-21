// Document storage. The UI only talks to the `DocumentRepository` interface, so a cloud
// backend (with server-side ownership/authorisation checks) can be added later by providing
// another implementation; today everything is stored locally in IndexedDB on this device.
import type { Folder, OcrResult, ScanDocument } from '../../types'
import { documentKind } from '../../types'
import { uid } from '../uid'
import { getDb, type DocumentRecord, type ExportRecord, type SignatureRecord, type StoredFile } from './db'

export type { DocumentRecord, ExportRecord, SignatureRecord, StoredFile }

export const EXPORT_HISTORY_LIMIT = 20

export interface DocumentRepository {
  listDocuments(): Promise<DocumentRecord[]>
  getDocument(id: string): Promise<DocumentRecord | undefined>
  saveDocument(doc: ScanDocument, thumb?: Blob | null): Promise<void>
  deleteDocument(id: string): Promise<void>

  listFolders(): Promise<Folder[]>
  saveFolder(folder: Folder): Promise<void>
  deleteFolder(id: string): Promise<void>

  putBlob(docId: string, blob: Blob): Promise<string>
  getBlob(id: string): Promise<Blob>
  collectGarbage(doc: ScanDocument): Promise<number>
}

export function pageOcrText(o: OcrResult | null) {
  return o ? (o.edited ?? o.text) : ''
}

function toRecord(doc: ScanDocument, thumb: Blob | null): DocumentRecord {
  const text = doc.pages.map((p) => pageOcrText(p.ocr)).join('\n')
  return {
    ...doc,
    thumb,
    pageCount: doc.pages.length,
    kind: documentKind(doc),
    searchText: `${doc.name}\n${text}`.toLowerCase(),
  }
}

const blobCache = new Map<string, Blob>()

class IndexedDbRepository implements DocumentRepository {
  async listDocuments() {
    const all = await (await getDb()).getAllFromIndex('documents', 'updatedAt')
    return all.reverse()
  }

  async getDocument(id: string) {
    return (await getDb()).get('documents', id)
  }

  async saveDocument(doc: ScanDocument, thumb?: Blob | null) {
    const db = await getDb()
    const prev = thumb === undefined ? await db.get('documents', doc.id) : undefined
    await db.put('documents', toRecord(doc, thumb === undefined ? (prev?.thumb ?? null) : thumb))
  }

  async deleteDocument(id: string) {
    const db = await getDb()
    const tx = db.transaction(['documents', 'blobs'], 'readwrite')
    await tx.objectStore('documents').delete(id)
    const keys = await tx.objectStore('blobs').index('docId').getAllKeys(id)
    for (const k of keys) {
      await tx.objectStore('blobs').delete(k)
      blobCache.delete(k)
    }
    await tx.done
  }

  async listFolders() {
    const all = await (await getDb()).getAll('folders')
    return all.sort((a, b) => a.name.localeCompare(b.name))
  }

  async saveFolder(folder: Folder) {
    await (await getDb()).put('folders', folder)
  }

  /** Deletes the folder; its documents are moved to "no folder", never deleted. */
  async deleteFolder(id: string) {
    const db = await getDb()
    const tx = db.transaction(['folders', 'documents'], 'readwrite')
    await tx.objectStore('folders').delete(id)
    const docs = await tx.objectStore('documents').index('folderId').getAll(id)
    for (const d of docs) await tx.objectStore('documents').put({ ...d, folderId: null })
    await tx.done
  }

  async putBlob(docId: string, blob: Blob) {
    const id = uid()
    await (await getDb()).put('blobs', { id, docId, blob, createdAt: Date.now() })
    blobCache.set(id, blob)
    return id
  }

  async getBlob(id: string) {
    const cached = blobCache.get(id)
    if (cached) return cached
    const rec = await (await getDb()).get('blobs', id)
    if (!rec) throw new Error('Page data is missing from storage')
    blobCache.set(id, rec.blob)
    return rec.blob
  }

  /** Removes blobs of a document that no page references any more (e.g. deleted pages). */
  async collectGarbage(doc: ScanDocument) {
    const used = new Set(doc.pages.map((p) => p.sourceId))
    const db = await getDb()
    const tx = db.transaction('blobs', 'readwrite')
    const keys = await tx.store.index('docId').getAllKeys(doc.id)
    let removed = 0
    for (const k of keys) {
      if (!used.has(k)) {
        await tx.store.delete(k)
        blobCache.delete(k)
        removed++
      }
    }
    await tx.done
    return removed
  }
}

export const repository: DocumentRepository = new IndexedDbRepository()

// ---------------------------------------------------------------- export history (v1 data)

export async function listExports(): Promise<ExportRecord[]> {
  return (await (await getDb()).getAllFromIndex('scans', 'createdAt')).reverse()
}

/** Saves an export and prunes history down to the newest EXPORT_HISTORY_LIMIT entries. */
export async function saveExport(record: ExportRecord) {
  const db = await getDb()
  const tx = db.transaction('scans', 'readwrite')
  await tx.store.put(record)
  const keys = await tx.store.index('createdAt').getAllKeys()
  for (let i = 0; i < keys.length - EXPORT_HISTORY_LIMIT; i++) await tx.store.delete(keys[i])
  await tx.done
}

export async function deleteExport(id: string) {
  await (await getDb()).delete('scans', id)
}

export const exportFiles = (r: ExportRecord) => r.files.map((f) => new File([f.blob], f.name, { type: f.type }))

// ---------------------------------------------------------------- signatures

export async function listSignatures(): Promise<SignatureRecord[]> {
  return (await (await getDb()).getAll('signatures')).sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveSignature(src: string) {
  const rec = { id: uid(), src, createdAt: Date.now() }
  await (await getDb()).put('signatures', rec)
  return rec
}

export async function deleteSignature(id: string) {
  await (await getDb()).delete('signatures', id)
}

// ---------------------------------------------------------------- storage management

export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.()
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null
  } catch {
    return null
  }
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

/** Permanently removes every document, folder, blob, signature and export on this device. */
export async function deleteAllData() {
  const db = await getDb()
  const stores = ['scans', 'documents', 'folders', 'blobs', 'signatures'] as const
  const tx = db.transaction([...stores], 'readwrite')
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()))
  await tx.done
  blobCache.clear()
}
