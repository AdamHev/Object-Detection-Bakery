import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { database, getDetection, getLatestDetection, serializeDetection } from './database.js';

const app = express();
export { app };
const PORT = Number(globalThis.process?.env.PORT) || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDirectory = globalThis.process?.env.UPLOAD_DIRECTORY || path.join(__dirname, 'uploads');

const storage = multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => {
        req.detectionId ??= randomUUID();
        const kind = file.fieldname === 'original_image' ? 'original' : 'annotated';
        callback(null, `${req.detectionId}-${kind}.png`);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024, files: 2 },
    fileFilter: (_req, file, callback) => callback(
        file.mimetype === 'image/png' ? null : new Error('Only PNG images are accepted.'),
        file.mimetype === 'image/png',
    ),
});
const detectionUpload = upload.fields([
    { name: 'original_image', maxCount: 1 },
    { name: 'annotated_image', maxCount: 1 },
    { name: 'image', maxCount: 1 }, // Backward compatibility with the earlier Pi script.
]);

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDirectory, { etag: true, maxAge: '1d' }));

let clients = [];
function sendEventToClients(data) {
    clients.forEach(({ res }) => res.write(`data: ${JSON.stringify(data)}\n\n`));
}

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const client = { id: randomUUID(), res };
    clients.push(client);
    const latest = getLatestDetection();
    if (latest) res.write(`data: ${JSON.stringify(latest)}\n\n`);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20000);
    req.on('close', () => {
        clearInterval(heartbeat);
        clients = clients.filter(({ id }) => id !== client.id);
    });
});

app.post('/detection', detectionUpload, (req, res) => {
    const body = req.body ?? {};
    const annotatedFile = req.files?.annotated_image?.[0] ?? req.files?.image?.[0];
    const originalFile = req.files?.original_image?.[0] ?? annotatedFile;
    let predictions;
    try {
        if (body.predictions) {
            predictions = JSON.parse(body.predictions);
        } else {
            const labels = JSON.parse(body.labels ?? '[]');
            const confidences = JSON.parse(body.confidences ?? '[]');
            predictions = labels.map((class_name, index) => ({ class_name, confidence: confidences[index] }));
        }
    } catch {
        return res.status(400).json({ error: 'predictions must be a valid JSON array.' });
    }

    const width = Number(body.image_width) || 1;
    const height = Number(body.image_height) || 1;
    const modelVersion = String(body.model_version || 'unknown');
    if (!annotatedFile || !originalFile || !body.timestamp || !Array.isArray(predictions)) {
        return res.status(400).json({ error: 'Original/annotated PNGs, timestamp, and predictions are required.' });
    }
    if (predictions.some((item) => !item.class_name || !Number.isFinite(Number(item.confidence)))) {
        return res.status(400).json({ error: 'Every prediction needs a class_name and numeric confidence.' });
    }

    const id = req.detectionId ?? randomUUID();
    const receivedAt = new Date().toISOString();
    try {
        database.exec('BEGIN');
        database.prepare('INSERT OR IGNORE INTO model_versions (name, first_seen_at) VALUES (?, ?)').run(modelVersion, receivedAt);
        database.prepare(`
            INSERT INTO detections
            (id, captured_at, received_at, model_version, original_image_path, annotated_image_path,
             image_width, image_height, predicted_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, body.timestamp, receivedAt, modelVersion, originalFile.path, annotatedFile.path, width, height, predictions.length);
        const insertPrediction = database.prepare(`
            INSERT INTO predictions (detection_id, class_name, confidence, x1, y1, x2, y2)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of predictions) {
            const box = Array.isArray(item.box) ? item.box : [null, null, null, null];
            insertPrediction.run(id, item.class_name, Number(item.confidence), ...box);
        }
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }

    const detection = getDetection(id);
    sendEventToClients(detection);
    res.status(201).json({ message: 'Detection stored.', detection });
});

app.get('/detection', (_req, res) => {
    const latest = getLatestDetection();
    if (!latest) return res.status(404).json({ error: 'No detection available yet.' });
    res.json(latest);
});

app.get('/detections', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const rows = database.prepare('SELECT * FROM detections ORDER BY received_at DESC LIMIT ?').all(limit);
    res.json(rows.map(serializeDetection));
});

app.get('/detections/:id', (req, res) => {
    const detection = getDetection(req.params.id);
    if (!detection) return res.status(404).json({ error: 'Detection not found.' });
    res.json(detection);
});

app.post('/confirm', (req, res) => {
    const { detection_id: detectionId, product, quantity, initials, notes = '' } = req.body ?? {};
    const detection = detectionId && getDetection(detectionId);
    const correctedCount = Number(quantity);
    if (!detection || !product || !Number.isInteger(correctedCount) || correctedCount < 0 || !initials) {
        return res.status(400).json({ error: 'A valid detection, product, quantity, and initials are required.' });
    }

    const classChanged = !detection.labels.includes(product);
    const countChanged = correctedCount !== detection.object_count;
    let correctionType = 'correct';
    if (classChanged && countChanged) correctionType = 'mixed';
    else if (classChanged) correctionType = 'wrong_class';
    else if (correctedCount > detection.object_count) correctionType = 'missing';
    else if (correctedCount < detection.object_count) correctionType = 'duplicate';

    const reviewedAt = new Date().toISOString();
    database.exec('BEGIN');
    try {
        database.prepare(`
            INSERT INTO reviews
            (detection_id, reviewer_initials, corrected_product, corrected_count, correction_type, notes, reviewed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(detectionId, initials, product, correctedCount, correctionType, String(notes), reviewedAt);
        database.prepare("UPDATE detections SET review_status = 'reviewed' WHERE id = ?").run(detectionId);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    res.json({ message: 'Review stored.', correction_type: correctionType });
});

app.get('/reviews', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 5000);
    const reviews = database.prepare(`
        SELECT r.*, d.captured_at, d.model_version, d.predicted_count,
               d.original_image_path, d.annotated_image_path
        FROM reviews r JOIN detections d ON d.id = r.detection_id
        ORDER BY r.reviewed_at DESC LIMIT ?
    `).all(limit);
    res.json(reviews);
});

app.get('/statistics', (_req, res) => {
    const totals = database.prepare(`
        SELECT
            (SELECT COUNT(*) FROM detections) AS detections,
            (SELECT COUNT(*) FROM predictions) AS predictions,
            (SELECT COUNT(*) FROM reviews) AS reviews,
            (SELECT COUNT(*) FROM detections WHERE review_status = 'pending') AS pending_reviews,
            (SELECT ROUND(AVG(confidence), 4) FROM predictions) AS average_confidence,
            (SELECT COUNT(*) FROM reviews WHERE correction_type = 'correct') AS correct_reviews
    `).get();
    const corrections = database.prepare(`
        SELECT correction_type, COUNT(*) AS count
        FROM reviews GROUP BY correction_type ORDER BY count DESC
    `).all();
    const models = database.prepare(`
        SELECT d.model_version,
               COUNT(*) AS detections,
               ROUND(AVG((SELECT AVG(p.confidence) FROM predictions p WHERE p.detection_id = d.id)), 4) AS average_confidence,
               SUM(CASE WHEN d.review_status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed
        FROM detections d GROUP BY d.model_version ORDER BY detections DESC
    `).all();
    const recentReviews = database.prepare(`
        SELECT r.detection_id, r.corrected_product, r.corrected_count,
               r.correction_type, r.reviewer_initials, r.reviewed_at,
               d.captured_at, d.model_version, d.predicted_count
        FROM reviews r JOIN detections d ON d.id = r.detection_id
        ORDER BY r.reviewed_at DESC LIMIT 10
    `).all();

    res.json({
        totals: {
            ...totals,
            review_accuracy: totals.reviews ? Number((totals.correct_reviews / totals.reviews).toFixed(4)) : null,
        },
        corrections,
        models,
        recent_reviews: recentReviews,
    });
});

app.use((error, _req, res, _next) => {
    void _next;
    console.error(error);
    res.status(error instanceof multer.MulterError ? 400 : 500).json({ error: error.message });
});

if (path.resolve(globalThis.process.argv[1] || '') === fileURLToPath(import.meta.url)) {
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running at http://0.0.0.0:${PORT}`));
}
