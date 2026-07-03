# Bakery detection review

A Raspberry Pi runs YOLO, uploads original and annotated PNGs plus detection metadata, and the React display receives the result live over server-sent events. Press **Detection** to show or hide the latest image and its confidence scores. Every detection is retained for model-improvement review.

## Run locally

```powershell
cd backend
npm install
npm start
```

In a second terminal:

```powershell
npm install
npm run dev -- --host
```

Open the Vite URL from the display. The frontend uses that page's hostname with port `3000` for the API. To use a different API address, set `VITE_API_URL` before starting/building the frontend.

The backend requires Node.js 22.5 or newer and creates `backend/bakery-detect.sqlite` automatically. Images are stored under `backend/uploads`. Back up both together. You can override their locations with `DATABASE_PATH` and `UPLOAD_DIRECTORY`.

Make sure TCP ports `3000` (backend) and `5173` (Vite development server) are allowed through the host firewall and that the Pi's `SERVER_URL` points to the backend machine's LAN IP.

## Raspberry Pi

Install `ultralytics`, `opencv-python`, and `requests`, then run:

```bash
SERVER_URL=http://192.168.1.17:3000/detection python scripts/imgdetectsave.py
```

The script accepts `MODEL_PATH`, `MODEL_VERSION`, `IMAGE_PATH`, `CONF_THRESH`, `OUTPUT_DIR`, and `SERVER_URL` as environment variables. Set `MODEL_VERSION` to a stable training-run name such as `bakery-yolo-v3`; otherwise the model filename is used.

## Upload API

`POST /detection` accepts `multipart/form-data`:

- `original_image`: untouched PNG (maximum 15 MB)
- `annotated_image`: annotated PNG (maximum 15 MB)
- `timestamp`: ISO 8601 timestamp
- `model_version`: model/training-run identifier
- `image_width` and `image_height`: source dimensions
- `predictions`: JSON array containing `class_name`, `confidence`, and `[x1, y1, x2, y2]` in `box`

Useful endpoints:

- `GET /detection`: latest detection
- `GET /detections?limit=50`: retained detection history
- `GET /detections/:id`: one detection and its boxes
- `GET /reviews?limit=100`: review data for analysis/export
- `GET /events`: live updates

Confirming a detection stores the corrected class/count, reviewer, notes, and an inferred correction type: `correct`, `missing`, `duplicate`, `wrong_class`, or `mixed`.
