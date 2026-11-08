# Detection benchmark

Corner-detection accuracy and speed on the photos in `test-images/`, measured against the
hand-labelled corners in `test-images/ground-truth.json`. Calibrated parameters (the ones the
plan marks as "(estimate)") and the run they came from are recorded here.

## How to measure

- **Browser (canonical):** `NO_HTTPS=1 npm run dev`, open `http://localhost:5173/harness.html`.
  Uses the app's real decode path and the detection worker. "Label" / "Edit label" sets ground
  truth (drag the 4 corners, or "No document"); "Append to benchmark doc" adds a section below.
- **Node (fast tuning loop):** `npm run bench` (add `BENCH_OUT="label"` to append a section).
  Same `detect-core` code; images are decoded with sharp instead of the browser.

## Metrics

- **IoU**: intersection-over-union of the detected and labelled quadrilaterals. For a
  "no document" image: 1 if detection correctly reports `none`, otherwise 0.
- **IoU ≥ 0.9**: share of images that would be cropped acceptably without manual fixes.
- **Max corner error**: worst corner distance as a share of the image diagonal.
- **ms**: detection only (working-size image → corners), excluding decode and worker transfer.
  The harness also shows decode time and the full worker round trip per image.

## Test set

| Image | Content | Background |
|---|---|---|
| IMG_6285 | Invoice, small in frame, crumpled | Light wood floor |
| IMG_6286 | Invoice, large in frame, crumpled | Light wood table |
| IMG_6287 | Invoice | Grey fabric sofa |
| IMG_6288 | Drawing on paper, rotated | Grey fabric sofa |
| IMG_6289 | No document (motion-blurred keyboard) | Desk |

All photos: iPhone, 4032×3024 JPEG, EXIF orientation 6. Five images are too few to calibrate
reliably. Add harder cases (low contrast, white paper on a white table, hand covering a
corner, page cut off by the frame, glare, receipts) before tuning thresholds seriously.

## Calibrated parameters

_None yet: Phase 1 records them here._

## Runs
