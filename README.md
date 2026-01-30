Real-time detection confirmation

This project is a simple real-time system for handling object detection results and confirming them manually.

A backend server receives detection data (for example from a Raspberry Pi running YOLO), pushes updates to connected clients, and a React frontend displays the latest detection in a form where it can be reviewed and confirmed by a human.

The goal is to keep the system small, understandable, and easy to extend. It could be extended, and used for logistics, and could be connected to the POS system.

How it works

A detection device sends data to the backend.
The backend stores the latest detection in memory.
Connected clients receive updates immediately.
A user reviews the detection and submits a confirmation.

Tech stack

Backend:
- Node.js
- Express
- Server-Sent Events (SSE)

Frontend:
- React
- Axios
- EventSource (native browser API)

This is just a concept.
No database is used. All data is stored in memory.

Backend API

GET /events  
Opens a Server-Sent Events connection.  
The connection stays open and receives new detection data whenever it arrives.  
If a detection already exists, it is sent immediately when the client connects.

POST /detection  
Receives detection data from the detection system.

Example payload:
```json
{
  "timestamp": "2026-01-30T10:42:00",
  "object_count": 3,
  "labels": ["croissant", "bagel"]
}
