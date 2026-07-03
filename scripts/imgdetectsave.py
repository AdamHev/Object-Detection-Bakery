import json
import os
from datetime import datetime

import cv2
import requests
from ultralytics import YOLO

# Override these on the Pi with environment variables when needed.
MODEL_PATH = os.getenv("MODEL_PATH", "best.pt")
IMAGE_PATH = os.getenv("IMAGE_PATH", "captured2.png")
CONF_THRESH = float(os.getenv("CONF_THRESH", "0.4"))
SERVER_URL = os.getenv("SERVER_URL", "http://192.168.1.17:3000/detection")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "annotated_images")
MODEL_VERSION = os.getenv("MODEL_VERSION", os.path.basename(MODEL_PATH))

if not os.path.isfile(MODEL_PATH):
    raise SystemExit(f"Model file '{MODEL_PATH}' not found.")

image = cv2.imread(IMAGE_PATH)
if image is None:
    raise SystemExit(f"Image '{IMAGE_PATH}' could not be loaded.")

print(f"Loading model: {MODEL_PATH}")
model = YOLO(MODEL_PATH, task="detect")
result = model(image, conf=CONF_THRESH, verbose=False)[0]

detected_labels = []
confidences = []
predictions = []
if result.boxes is not None:
    for detection in result.boxes:
        confidence = float(detection.conf.item())
        if confidence >= CONF_THRESH:
            class_index = int(detection.cls.item())
            label = model.names[class_index]
            box = [round(value, 2) for value in detection.xyxy[0].tolist()]
            detected_labels.append(label)
            confidences.append(round(confidence, 4))
            predictions.append({
                "class_name": label,
                "confidence": round(confidence, 4),
                "box": box,
            })

os.makedirs(OUTPUT_DIR, exist_ok=True)
timestamp = datetime.now().astimezone()
annotated_path = os.path.join(OUTPUT_DIR, f"detection_{timestamp:%Y%m%d_%H%M%S}.png")
original_path = os.path.join(OUTPUT_DIR, f"original_{timestamp:%Y%m%d_%H%M%S}.png")
if not cv2.imwrite(annotated_path, result.plot()):
    raise SystemExit(f"Could not save annotated image to '{annotated_path}'.")
if not cv2.imwrite(original_path, image):
    raise SystemExit(f"Could not save original image to '{original_path}'.")

payload = {
    "timestamp": timestamp.strftime("%Y-%m-%d %H:%M"),
    "object_count": str(len(detected_labels)),
    "labels": json.dumps(detected_labels),
    "confidences": json.dumps(confidences),
    "predictions": json.dumps(predictions),
    "image_width": str(image.shape[1]),
    "image_height": str(image.shape[0]),
    "model_version": MODEL_VERSION,
}

print(f"Uploading {len(detected_labels)} detection(s) to {SERVER_URL}...")
try:
    with open(annotated_path, "rb") as annotated_file, open(original_path, "rb") as original_file:
        response = requests.post(
            SERVER_URL,
            data=payload,
            files={
                "annotated_image": (os.path.basename(annotated_path), annotated_file, "image/png"),
                "original_image": (os.path.basename(original_path), original_file, "image/png"),
            },
            timeout=15,
        )
    response.raise_for_status()
    print("Detection uploaded successfully.")
except requests.RequestException as error:
    detail = error.response.text if error.response is not None else str(error)
    raise SystemExit(f"Upload failed: {detail}") from error
