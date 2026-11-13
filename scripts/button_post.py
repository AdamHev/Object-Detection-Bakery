import os
import time
import json
from datetime import datetime
import requests
import RPi.GPIO as GPIO
import cv2
import numpy as np
from picamera2 import Picamera2
from ultralytics import YOLO

# === CONFIG ===
BUTTON_PIN = 17
MODEL_PATH = "best_ncnn_model"
RESOLUTION = (640, 480)
CONF_THRESH = 0.4
SERVER_URL = "http://192.168.1.***:3000/detection"

# === GPIO SETUP ===
GPIO.setmode(GPIO.BCM)
GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)

# === CAMERA SETUP ===
camera = Picamera2()
camera.configure(camera.create_video_configuration(main={"format": 'XRGB8888', "size": RESOLUTION}))
camera.start()

# === LOAD YOLO MODEL ===
if not os.path.exists(MODEL_PATH):
    print("Model file not found!")
    exit(1)

model = YOLO(MODEL_PATH, task='detect')
labels = model.names

def detect_and_post():
    print("Button pressed. Capturing image...")
    frame_bgra = camera.capture_array()
    frame = cv2.cvtColor(np.copy(frame_bgra), cv2.COLOR_BGRA2BGR)

    # Run detection
    results = model(frame, verbose=False)
    detections = results[0].boxes

    timestamp_raw = datetime.now()
    timestamp = timestamp_raw.strftime("%H:%M")

    detected_labels = []
    for det in detections:
        conf = det.conf.item()
        if conf >= CONF_THRESH:
            class_idx = int(det.cls.item())
            label = labels[class_idx]
            detected_labels.append(label)

    result = {
        "timestamp": timestamp,
        "object_count": len(detected_labels),
        "labels": list(set(detected_labels)),
    }

    print("Posting result to server...")
    try:
        response = requests.post(SERVER_URL, json=result)
        if response.ok:
            print("Posted successfully.")
        else:
            print(f"Server error: {response.status_code}")
    except Exception as e:
        print(f"Error posting to server: {e}")

# === MAIN LOOP ===
print("Press the button to detect and send results...")
try:
    while True:
        if GPIO.input(BUTTON_PIN) == GPIO.LOW:
            detect_and_post()
            time.sleep(1)
except KeyboardInterrupt:
    print("Exiting.")
finally:
    camera.stop()
    GPIO.cleanup()