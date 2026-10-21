# Scanner

A mobile-first PWA for scanning, editing and organising documents. Everything — edge detection,
perspective correction, image enhancement, OCR, PDF creation/editing, storage — runs **locally in the
browser**. There is no backend and no file is ever uploaded.

Live: https://igorinbyte.github.io/scanner-pwa/

## Features

**Capture & import**
- Camera (`getUserMedia`, rear camera) with fallback to the system camera; single-page or multi-page mode.
- Import many photos at once (JPG, PNG, WebP) and existing PDFs (incl. password-protected ones).
- Files are validated by type *and magic bytes* and size (images ≤ 40 MB, PDFs ≤ 200 MB); damaged files
  are reported with a reason and a "choose other files" retry.
- Photos are downscaled to max 2480 px (longer side) on import.

**Scan editing**
- Automatic detection of the 4 document corners (OpenCV.js), with a clear message when the outline was found
  only approximately or not at all; manual corner dragging with a magnifier (also keyboard-accessible).
- Perspective correction (homography) with Auto / A4 / A5 / Letter proportions.
- Filters: Original, Auto, Color, Grayscale, B&W (adaptive threshold), Text emphasis.
- Manual sliders: brightness, contrast, sharpness, noise reduction, shadow removal, background whitening.
- Automatic vs manual mode, before/after split view, rotate 90/180/270, reset, "apply to all pages".
- The original image is always kept; every preview/export is rendered from the original + current settings.

**Multi-page documents**
- Thumbnail grid with per-page status, drag & drop reorder, multi-select, rotate, duplicate, delete,
  filter for selected pages, extract selection, add pages from camera / photos / PDF (merge).
- Undo/redo for every edit (Ctrl+Z / Ctrl+Shift+Z), "Undo" after deleting pages.
- Autosave of drafts to IndexedDB — closing the tab or a crash never loses work.

**PDF**
- Export all / selected / page ranges; split into one PDF per range.
- Page size A4 / A5 / Letter / Auto, portrait / landscape / auto, 3 quality levels, file size shown.
- Pages of imported PDFs are copied as-is (text and vector content preserved); optional conversion to images.
- Invisible OCR text layer (searchable, selectable PDF), annotations, signature, watermark.
- Real AES-256 password protection.
- Preview of the generated PDF (pdf.js) before downloading or sharing.
- Also JPG / PNG per page (marks burned in), TXT and DOCX (OCR text).

**OCR**
- Tesseract.js with Croatian + English, Croatian or English; page or whole document; progress and stop.
- Editable recognised text, copy page/all, full-text search with highlighted word boxes on the page.
- PDF pages that already contain text are extracted directly (no OCR).
- Text is saved with the document and is searchable from the library.

**Annotations, signature, watermark**
- Highlight, underline, box, freehand, text notes, eraser; select / move / resize; color and size.
- Signature: draw, import an image (optional white-background removal) or reuse a saved one.
  It is a *visual* signature — not a qualified electronic signature (the app says so).
- Text watermark (position, size, opacity, color, on/off).

**Library**
- Documents with thumbnail, type, page count, created / edited dates, draft badge.
- Folders (create, rename, delete — documents are kept), move, rename, delete (with confirmation),
  quick "Download as PDF".
- Search by name and OCR text; filters by type and date.
- Export history (last 20, kept from the original version), storage usage, "delete all data".

## Architecture

```
src/
  App.tsx                     routing (mirrored into browser history for the back button)
  screens/                    LibraryScreen, EditorScreen, CameraScreen
  editor/                     PageList, CropView, EnhanceView, AnnotateView (+ AnnotationLayer,
                              SignatureDialog), OcrView, ExportDialog, PdfPreview, usePreview
  components/                 dialogs (confirm/prompt/toast), CornerEditor, ui, icons
  workers/imaging.worker.ts   image pipeline off the main thread (OffscreenCanvas)
  lib/
    imaging/                  edge detection (OpenCV), perspective (homography + warp),
                              enhancement filters, pipeline, worker facade with main-thread fallback
    pdf/                      export (pdf-lib), layout & coordinate mapping, page ranges, pdf.js
    ocr/                      Tesseract engine, TXT / DOCX export
    annotations/              raster drawing of marks / watermark
    document/                 import, useDocument (undo/redo + autosave), useProcessing (queue)
    storage/                  IndexedDB schema (v1 → v2 migration) and DocumentRepository
    files.ts, share.ts        validation & file names, Web Share / download / mailto
```

- **Storage** goes through the `DocumentRepository` interface (`src/lib/storage/repository.ts`).
  The only implementation is IndexedDB on the device. A cloud backend can be added as another
  implementation — it must then enforce ownership/authorisation on the server.
- Heavy pixel work runs in a **Web Worker**; browsers without `OffscreenCanvas` fall back to the main thread.
- Large assets are **lazy-loaded** and self-hosted under `/vendor` (copied from npm by
  `scripts/copy-vendor.mjs` on `npm install`): OpenCV.js, Tesseract worker/core + hrv/eng models, the
  DejaVu Sans font (Unicode text in PDFs) and pdf.js data. The app shell and OpenCV are precached for
  offline use; OCR models, font and pdf.js data are cached on first use.

### Libraries

| Library | Why |
|---|---|
| `@techstark/opencv-js` | document edge detection |
| `@cantoo/pdf-lib` + `@cantoo/fontkit` | PDF creation/editing, AES encryption, Unicode font subsetting (maintained pdf-lib fork) |
| `pdfjs-dist` | rendering and reading existing PDFs, preview |
| `tesseract.js` + `@tesseract.js-data/hrv`, `/eng` | on-device OCR |
| `docx` | DOCX export |
| `idb` | IndexedDB |
| `@dnd-kit/*` | accessible drag & drop |
| `dejavu-fonts-ttf` (dev) | font with č ć đ š ž for PDF text |
| `vitest` (dev) | unit / integration tests |

No API keys, environment variables or external services are needed.

## Development

Requires Node 20+.

```bash
npm install          # also copies the vendor assets into public/vendor
npm run dev          # https://localhost:5173 and https://<your-LAN-IP>:5173
npm test             # unit + integration tests (image pipeline, PDF export, ranges, validation)
npm run typecheck
npm run build
```

## Known limitations

- Everything is stored only on this device; the browser may evict data when storage is low (the app
  requests persistent storage). There is no account, sync or share-link feature — that needs a backend.
- OCR is weaker on handwriting, poor lighting, tables and multi-column layouts; the text can be corrected.
- Thumbnails show the processed page without annotations (annotations are visible in the editor and exports).
- Annotations are flattened into the page content of exported PDFs (not editable PDF annotation objects).
- A PDF opened with a password is stored decrypted on the device so it can be edited.
- "Convert PDF pages to images" only shrinks image-heavy PDFs; text/vector pages can get bigger.

### Testing on a phone

The camera API needs HTTPS, so the dev server uses a self-signed certificate
(`@vitejs/plugin-basic-ssl`). `npm run preview` serves the production build over HTTPS as well.

1. Connect the phone and the computer to the same Wi-Fi network.
2. Run `npm run dev` and open the **Network** URL it prints (e.g. `https://192.168.1.80:5173`) on the phone.
3. Accept the certificate warning:
   - **Android Chrome**: *Advanced → Proceed to …*
   - **iOS Safari**: *Show Details → visit this website*
4. Allow camera access when asked.
5. If the computer's firewall blocks the port, allow Node.js on private networks.

To test the service worker and offline mode, run `npm run build && npm run preview`.

## Production build

```bash
npm run build        # output in dist/
```

## Deploy

The app is fully static, so any static host works. HTTPS is required, and all hosts below provide it
automatically.

### GitHub Pages (configured)

`.github/workflows/deploy.yml` builds and deploys `dist/` on every push to `main`. The production build
uses the base path `/scanner-pwa/` (`BASE` in `vite.config.ts`); the dev server stays at `/`.
Enable Pages once with **Settings → Pages → Source: GitHub Actions**, or:

```bash
gh api -X POST repos/<user>/scanner-pwa/pages -f build_type=workflow
```

The app is then served at `https://<user>.github.io/scanner-pwa/`.

If you rename the repo or deploy to a custom domain / Vercel / Netlify (served from `/`), change `BASE`
in `vite.config.ts` to match (`'/'` for root).

### Vercel

1. Push the project to GitHub, GitLab or Bitbucket.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Vercel detects Vite. Check the settings:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install` (runs the `postinstall` that copies OpenCV)
4. Click **Deploy**.

Or use the CLI: `npm i -g vercel && vercel --prod`.

### Netlify

1. Push to a Git provider. In Netlify, choose **Add new site → Import an existing project**.
2. Build command: `npm run build`. Publish directory: `dist`.
3. Click **Deploy**.

Or use the CLI: `npm i -g netlify-cli && netlify deploy --build --prod`.

Optional `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "no-cache"
```

### After deploying

- Open the site on the phone. Install it with **Share → Add to Home Screen** on iOS Safari, or
  **⋮ → Install app** on Android Chrome.
- Updates are applied automatically (`registerType: 'autoUpdate'`) the next time the app is opened.

## Browser notes

| | iOS Safari 15.4+ | Android Chrome |
|---|---|---|
| Camera (`getUserMedia`) | ✅ (HTTPS) | ✅ (HTTPS) |
| Share files (PDF / images) | ✅ | ✅ |
| Install to home screen | ✅ (manual, via Share menu) | ✅ (install prompt) |
| Offline | ✅ | ✅ |

Desktop browsers without file sharing (e.g. Firefox) get the Download and email fallback.

## Regenerating icons

Edit `public/favicon.svg`, then run `npm run icons`.
