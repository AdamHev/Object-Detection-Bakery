# Bakery detection review

A Raspberry Pi runs YOLO, uploads its latest annotated PNG and detection metadata, and the React display receives the result live over server-sent events. Press **Detection** to show or hide the latest image and its confidence scores. A newer upload replaces the detection currently shown.

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

Make sure TCP ports `3000` (backend) and `5173` (Vite development server) are allowed through the host firewall and that the Pi's `SERVER_URL` points to the backend machine's LAN IP.

## Raspberry Pi

Install `ultralytics`, `opencv-python`, and `requests`, then run:

```bash
SERVER_URL=http://192.168.1.17:3000/detection python scripts/imgdetectsave.py
```

The script accepts `MODEL_PATH`, `IMAGE_PATH`, `CONF_THRESH`, `OUTPUT_DIR`, and `SERVER_URL` as environment variables.

## Upload API

`POST /detection` accepts `multipart/form-data`:

- `image`: annotated PNG (maximum 15 MB)
- `timestamp`: ISO 8601 timestamp
- `object_count`: integer
- `labels`: JSON array of label strings
- `confidences`: JSON array of confidence numbers from 0 to 1

`GET /detection` returns the latest metadata, `/uploads/<id>` serves its image, and `GET /events` sends live updates.
