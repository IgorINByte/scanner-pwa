# Scanner

A mobile-first PWA for scanning documents with your phone. Everything (edge detection, perspective
correction, filters, PDF generation, history) runs **locally in the browser**. There is no backend and
nothing is uploaded.

## Features

- **Capture**: rear camera via `getUserMedia`, with a fallback to the system camera
  (`<input capture="environment">`). You can also import several images from the gallery at once.
- **Modes**: *Single page* (shoot, then go straight to the editor) or *Multi-page* (shoot continuously,
  with a page counter and the last thumbnail shown).
- **Editing**: automatic 4-corner detection (OpenCV.js), corner dragging with a magnifier loupe,
  perspective correction, and four filters: Original, Document (B&W adaptive threshold), Grayscale and
  Enhanced color. You can rotate by 90°, delete pages and reorder them by long-press and drag.
- **Export**: one A4 PDF (Low/Medium/High quality), or a separate JPEG/PNG per page. The file name
  defaults to `Scan_YYYY-MM-DD_HHMM` and you can edit it.
- **Share**: `navigator.share({ files })` opens the system share sheet. Where sharing files isn't
  supported, you get Download plus *Send by email* (a `mailto:` link and a hint to attach the downloaded
  file).
- **History**: the last 20 exports are kept in IndexedDB, with thumbnail, date, page count and size. You
  can re-share or delete them.
- **Offline**: a service worker precaches the app, including OpenCV.js. You can add it to the home screen.

## Tech

Vite 8 · React 19 · TypeScript · Tailwind CSS 4 · vite-plugin-pwa (Workbox) · OpenCV.js
(`@techstark/opencv-js`) · pdf-lib · idb · dnd-kit

### Implementation notes

- Images are downscaled to **max 2480 px** on the longer side as soon as they are captured or imported
  (`src/lib/image.ts`).
- **OpenCV is lazy-loaded.** `npm install` copies `opencv.js` (~11 MB) to `public/vendor/` (see
  `scripts/copy-opencv.mjs`). It is injected as a `<script>` only when it is first needed: when the camera
  opens or an image is imported. A "Loading scanner engine…" banner shows while it loads.
- pdf-lib is also code-split and only loaded when you export a PDF.
- iOS Safari only allows `navigator.share()` synchronously inside a tap. Because of this, the export
  screen generates the files **ahead of time**, and the Share button calls `share()` immediately.

```
src/
  App.tsx              screen routing (mirrored into history for the Android back button)
  screens/             Home, Camera, Pages (grid + reorder), Edit (crop/filters), Export
  components/          CornerEditor, shared UI, icons
  lib/opencv.ts        lazy loader + status store
  lib/scan.ts          corner detection, perspective warp, document filter
  lib/render.ts        page rendering pipeline (warp → filter → rotate)
  lib/export.ts        PDF / image generation, file naming
  lib/share.ts         Web Share, downloads, mailto
  lib/db.ts            IndexedDB history
  lib/usePages.ts      current scan state + background detection/thumbnail queue
```

## Development

Requires Node 20+.

```bash
npm install          # also copies opencv.js into public/vendor
npm run dev          # https://localhost:5173 and https://<your-LAN-IP>:5173
```

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
