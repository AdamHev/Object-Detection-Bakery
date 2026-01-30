import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

let latestDetection = null;
let confirmedEntries = [];
let clients = [];

// Function to send events to all connected clients
function sendEventToClients(data) {
    console.log(`Sending event to ${clients.length} client(s)`);
    clients.forEach(client => {
        // Format as SSE message: data: <json string>\n\n
        client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}


app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    const newClient = {
        id: clientId,
        res: res 
    };
    clients.push(newClient);
    console.log(`Client connected: ${clientId} (${clients.length} total)`);

    if (latestDetection) {
         console.log(`Sending current detection to new client ${clientId}`);
         res.write(`data: ${JSON.stringify(latestDetection)}\n\n`);
    }

    // Handle client disconnection
    req.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        clients = clients.filter(client => client.id !== clientId);
        res.end();
    });
});

// Detection endpoint to receive new detection data
app.post('/detection', (req, res) => {
    const { timestamp, object_count, labels } = req.body;
    if (timestamp === undefined || object_count === undefined || !Array.isArray(labels)) {
        return res.status(400).json({ error: "Invalid detection payload format." });
    }
    latestDetection = { timestamp, object_count, labels };
    console.log("Detection received:", latestDetection);

    sendEventToClients(latestDetection);

    res.status(200).json({ message: "Detection saved and event sent." });
});

// Original endpoint to get the latest detection (still useful for initial load or manual refresh)
app.get('/detection', (req, res) => {
    if (!latestDetection) {
        return res.status(404).json({ error: "No detection data available yet." });
    }
    res.json(latestDetection);
});

// Original endpoint for confirmation
app.post('/confirm', (req, res) => {
    const { product, quantity, time, initials } = req.body;
    if (!product || quantity === undefined || !time || !initials) {
         return res.status(400).json({ error: "Missing fields in confirmation." });
    }
    const entry = { product, quantity, time, initials, submittedAt: new Date().toISOString() };
    confirmedEntries.push(entry);
    console.log("Confirmation received:", entry);
    res.status(200).json({ message: "Confirmation saved." });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});