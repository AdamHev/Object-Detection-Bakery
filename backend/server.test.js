import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

const testRoot = path.resolve('.test-data');
rmSync(testRoot, { recursive: true, force: true });
mkdirSync(testRoot, { recursive: true });
globalThis.process.env.DATABASE_PATH = path.join(testRoot, 'test.sqlite');
globalThis.process.env.UPLOAD_DIRECTORY = path.join(testRoot, 'uploads');

const { app } = await import('./server.js');
const { database } = await import('./database.js');

test('stores an upload and its human review', async (context) => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    context.after(() => {
        server.close();
        database.close();
        rmSync(testRoot, { recursive: true, force: true });
    });

    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const form = new FormData();
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    form.append('original_image', png, 'original.png');
    form.append('annotated_image', png, 'annotated.png');
    form.append('timestamp', '2026-07-03 13:48');
    form.append('model_version', 'test-v1');
    form.append('image_width', '640');
    form.append('image_height', '480');
    form.append('predictions', JSON.stringify([{ class_name: 'croissant', confidence: 0.91, box: [1, 2, 30, 40] }]));

    const uploadResponse = await fetch(`${baseUrl}/detection`, { method: 'POST', body: form });
    assert.equal(uploadResponse.status, 201);
    const { detection } = await uploadResponse.json();
    assert.equal(detection.labels[0], 'croissant');
    assert.deepEqual(detection.predictions[0].box, undefined);
    assert.equal(detection.predictions[0].x1, 1);

    const reviewResponse = await fetch(`${baseUrl}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ detection_id: detection.id, product: 'croissant', quantity: 2, initials: 'AB' }),
    });
    assert.equal(reviewResponse.status, 200);
    assert.equal((await reviewResponse.json()).correction_type, 'missing');

    const reviewsResponse = await fetch(`${baseUrl}/reviews`);
    assert.equal(reviewsResponse.status, 200);
    assert.equal((await reviewsResponse.json()).length, 1);

    const statisticsResponse = await fetch(`${baseUrl}/statistics`);
    assert.equal(statisticsResponse.status, 200);
    const statistics = await statisticsResponse.json();
    assert.equal(statistics.totals.detections, 1);
    assert.equal(statistics.totals.reviews, 1);
    assert.equal(statistics.corrections[0].correction_type, 'missing');
});
