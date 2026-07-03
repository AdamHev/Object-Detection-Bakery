import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = globalThis.process?.env.DATABASE_PATH || path.join(__dirname, 'bakery-detect.sqlite');
export const database = new DatabaseSync(databasePath);

database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS model_versions (
        name TEXT PRIMARY KEY,
        first_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS detections (
        id TEXT PRIMARY KEY,
        captured_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        model_version TEXT NOT NULL REFERENCES model_versions(name),
        original_image_path TEXT NOT NULL,
        annotated_image_path TEXT NOT NULL,
        image_width INTEGER NOT NULL,
        image_height INTEGER NOT NULL,
        predicted_count INTEGER NOT NULL,
        review_status TEXT NOT NULL DEFAULT 'pending'
            CHECK (review_status IN ('pending', 'reviewed'))
    );

    CREATE TABLE IF NOT EXISTS predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        detection_id TEXT NOT NULL REFERENCES detections(id) ON DELETE CASCADE,
        class_name TEXT NOT NULL,
        confidence REAL NOT NULL,
        x1 REAL,
        y1 REAL,
        x2 REAL,
        y2 REAL
    );

    CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        detection_id TEXT NOT NULL REFERENCES detections(id) ON DELETE CASCADE,
        reviewer_initials TEXT NOT NULL,
        corrected_product TEXT NOT NULL,
        corrected_count INTEGER NOT NULL,
        correction_type TEXT NOT NULL
            CHECK (correction_type IN ('correct', 'missing', 'duplicate', 'wrong_class', 'mixed')),
        notes TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS predictions_detection_idx ON predictions(detection_id);
    CREATE INDEX IF NOT EXISTS reviews_detection_idx ON reviews(detection_id);
    CREATE INDEX IF NOT EXISTS detections_received_idx ON detections(received_at DESC);
`);

const latestStatement = database.prepare(`
    SELECT * FROM detections ORDER BY received_at DESC LIMIT 1
`);
const predictionsStatement = database.prepare(`
    SELECT class_name, confidence, x1, y1, x2, y2
    FROM predictions WHERE detection_id = ? ORDER BY id
`);

export function serializeDetection(row) {
    if (!row) return null;
    const predictions = predictionsStatement.all(row.id);
    return {
        id: row.id,
        timestamp: row.captured_at,
        received_at: row.received_at,
        model_version: row.model_version,
        object_count: row.predicted_count,
        image_width: row.image_width,
        image_height: row.image_height,
        review_status: row.review_status,
        image_url: `/uploads/${path.basename(row.annotated_image_path)}`,
        original_image_url: `/uploads/${path.basename(row.original_image_path)}`,
        labels: predictions.map((item) => item.class_name),
        confidences: predictions.map((item) => item.confidence),
        predictions,
    };
}

export function getLatestDetection() {
    return serializeDetection(latestStatement.get());
}

export function getDetection(id) {
    return serializeDetection(database.prepare('SELECT * FROM detections WHERE id = ?').get(id));
}
