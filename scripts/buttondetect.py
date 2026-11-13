import json
import os
import time

os.environ.setdefault("GPIOZERO_PIN_FACTORY", "lgpio")
from gpiozero import Button
from picamera2 import Picamera2
from datetime import datetime

import cv2
import requests
from ultralytics import YOLO

MODEL_PATH = os.getenv("MODEL_PATH", "best.pt")
BUTTON_GPIO = int(os.getenv("BUTTON_GPIO", "17")) 
CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))
CAPTURE_WIDTH = int(os.getenv("CAPTURE_WIDTH", "1640"))
CAPTURE_HEIGHT = int(os.getenv("CAPTURE_HEIGHT", "1232"))
CONF_THRESH = float(os.getenv("CONF_THRESH", "0.4"))
SERVER_URL = os.getenv("SERVER_URL", "http://192.168.0.178:3000/detection")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "annotated_images")    
MODEL_VERSION = os.getenv("MODEL_VERSION", os.path.basename(MODEL_PATH))

def detect_and_upload(model, image):
    """Keep the original detection payload and save both images before upload."""
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
    annotated_path = os.path.join(OUTPUT_DIR, f"detection_{timestamp:%Y%m%d_%H%M%S_%f}.png")
    original_path = os.path.join(OUTPUT_DIR, f"original_{timestamp:%Y%m%d_%H%M%S_%f}.png")
    if not cv2.imwrite(annotated_path, result.plot()):
        raise RuntimeError(f"Could not save annotated image to '{annotated_path}'.")
    if not cv2.imwrite(original_path, image):
        raise RuntimeError(f"Could not save original image to '{original_path}'.")

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
        raise RuntimeError(f"Upload failed: {detail}") from error


def main():
    if not os.path.exists(MODEL_PATH):
        raise SystemExit(f"Model '{MODEL_PATH}' not found (file or exported model directory).")
    if CAPTURE_WIDTH <= 0 or CAPTURE_HEIGHT <= 0:
        raise SystemExit("Capture dimensions must be positive.")

    print(f"Loading model: {MODEL_PATH}")
    model = YOLO(MODEL_PATH, task="detect")
    camera = Picamera2(CAMERA_INDEX)
    try:
        camera.configure(camera.create_still_configuration(
            main={"size": (CAPTURE_WIDTH, CAPTURE_HEIGHT), "format": "RGB888"},
            buffer_count=2,
        ))
        camera.start()
        time.sleep(2)
        with Button(BUTTON_GPIO, pull_up=True, bounce_time=0.1) as button:
            print(f"Ready: press GPIO{BUTTON_GPIO} button to capture. Ctrl+C to stop.")
            button.wait_for_release()
            while True:
                button.wait_for_press()
                try:
                    print("Capturing image...")
                    image = camera.capture_array("main")
                    detect_and_upload(model, image)
                except Exception as error:
                    print(f"Capture/detection/upload failed: {error}", flush=True)
                button.wait_for_release()
                print("Ready for next press.", flush=True)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        camera.close()


if __name__ == "__main__":
    main()
