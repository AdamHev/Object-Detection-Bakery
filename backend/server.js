import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = Number(globalThis.process?.env.PORT) || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDirectory = path.join(__dirname, 'uploads');

const upload = multer({
    storage: multer.diskStorage({
        destination: uploadDirectory,
        filename: (_req, _file, callback) => callback(null, 'latest.png'),
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        callback(file.mimetype === 'image/png' ? null : new Error('Only PNG images are accepted.'), file.mimetype === 'image/png');
    },
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDirectory, { etag: false, maxAge: 0 }));

let latestDetection = null;
const confirmedEntries = [];
let clients = [];

function sendEventToClients(data) {
    clients.forEach(({ res }) => res.write(`data: ${JSON.stringify(data)}\n\n`));
}

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const client = { id: Date.now() + Math.random(), res };
    clients.push(client);
    if (latestDetection) res.write(`data: ${JSON.stringify(latestDetection)}\n\n`);

    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20000);
    req.on('close', () => {
        clearInterval(heartbeat);
        clients = clients.filter(({ id }) => id !== client.id);
    });
});

// Raspberry Pi upload: multipart/form-data with a PNG field named "image".
app.post('/detection', upload.single('image'), (req, res) => {
    const body = req.body ?? {};
    let labels;
    let confidences;
    try {
        labels = JSON.parse(body.labels ?? '[]');
        confidences = JSON.parse(body.confidences ?? '[]');
    } catch {
        return res.status(400).json({ error: 'labels and confidences must be JSON arrays.' });
    }

    const objectCount = Number(body.object_count);
    if (!req.file || !body.timestamp || !Number.isInteger(objectCount) || !Array.isArray(labels) || !Array.isArray(confidences)) {
        return res.status(400).json({ error: 'A PNG image, timestamp, object_count, labels, and confidences are required.' });
    }

    latestDetection = {
        timestamp: body.timestamp,
        object_count: objectCount,
        labels,
        confidences: confidences.map(Number),
        image_url: '/uploads/latest.png',
        received_at: new Date().toISOString(),
    };
    sendEventToClients(latestDetection);
    res.status(201).json({ message: 'Detection uploaded.', detection: latestDetection });
});

app.get('/detection', (_req, res) => {
    if (!latestDetection) return res.status(404).json({ error: 'No detection available yet.' });
    res.json(latestDetection);
});

app.post('/confirm', (req, res) => {
    const { product, quantity, time, initials } = req.body ?? {};
    if (!product || quantity === undefined || !time || !initials) {
        return res.status(400).json({ error: 'Missing fields in confirmation.' });
    }
    confirmedEntries.push({ product, quantity, time, initials, submittedAt: new Date().toISOString() });
    res.json({ message: 'Confirmation saved.' });
});

app.use((error, _req, res, _next) => {
    void _next;
    res.status(error instanceof multer.MulterError ? 400 : 415).json({ error: error.message });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
});
