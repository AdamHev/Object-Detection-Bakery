import { useCallback, useEffect, useState } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;

function formatTimestamp(timestamp) {
    const match = String(timestamp).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    return match ? `${match[1]} ${match[2]}` : timestamp;
}

export default function DetectionForm() {
    const [formData, setFormData] = useState(null);
    const [showDetection, setShowDetection] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState(null);

    const processDetectionData = useCallback((data) => {
        if (!data || !Array.isArray(data.labels) || !Array.isArray(data.confidences) || !data.image_url) {
            setError("The server returned an invalid detection.");
            return;
        }
        setFormData((previous) => ({
            product: data.labels[0] || "",
            otherLabels: data.labels.slice(1),
            quantity: String(data.object_count),
            time: formatTimestamp(data.timestamp),
            initials: previous?.initials || "",
            confidences: data.confidences,
            labels: data.labels,
            imageUrl: `${API_BASE}${data.image_url}?v=${encodeURIComponent(data.received_at || Date.now())}`,
        }));
        setSubmitted(false);
        setError(null);
    }, []);

    const fetchLatest = useCallback(async () => {
        try {
            processDetectionData((await axios.get(`${API_BASE}/detection`)).data);
        } catch (requestError) {
            setError(requestError.response?.status === 404
                ? "No detection yet. Waiting for the Raspberry Pi…"
                : "Cannot connect to the detection server.");
        }
    }, [processDetectionData]);

    useEffect(() => {
        fetchLatest();
        const events = new EventSource(`${API_BASE}/events`);
        events.onmessage = ({ data }) => {
            try { processDetectionData(JSON.parse(data)); }
            catch { setError("The server sent a malformed update."); }
        };
        events.onerror = () => setError("Live connection interrupted; reconnecting…");
        return () => events.close();
    }, [fetchLatest, processDetectionData]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            await axios.post(`${API_BASE}/confirm`, {
                product: formData.product,
                quantity: Number(formData.quantity),
                time: formData.time,
                initials: formData.initials,
            });
            setSubmitted(true);
            setError(null);
        } catch (requestError) {
            setError(requestError.response?.data?.error || "Confirmation failed.");
        }
    };

    const averageConfidence = formData?.confidences.length
        ? formData.confidences.reduce((sum, value) => sum + value, 0) / formData.confidences.length
        : null;

    return (
        <main className="detection-form-wrapper">
            <div className="card-header">
                <div><span className="eyebrow">Live review</span><h2>Confirm Detection</h2></div>
                <button className="detection-btn" disabled={!formData} onClick={() => setShowDetection((visible) => !visible)}>
                    {showDetection ? "Hide detection" : "Detection"}
                </button>
            </div>

            {error && <p className="error-msg">{error}</p>}
            {submitted && <p className="success-msg">Detection confirmed.</p>}

            {showDetection && formData && (
                <section className="detection-preview">
                    <img src={formData.imageUrl} alt="Latest annotated bakery detection" />
                    <div className="confidence-summary">
                        <strong>{averageConfidence === null ? "—" : `${(averageConfidence * 100).toFixed(1)}%`}</strong>
                        <span>Average confidence</span>
                    </div>
                    <ul>{formData.labels.map((label, index) => <li key={`${label}-${index}`}><span>{label}</span><b>{((formData.confidences[index] || 0) * 100).toFixed(1)}%</b></li>)}</ul>
                </section>
            )}

            {!formData ? <button className="refresh-btn" onClick={fetchLatest}>Try again</button> : (
                <form onSubmit={handleSubmit} className="detection-form">
                    <label>Product</label>
                    <select value={formData.product} onChange={(event) => setFormData({ ...formData, product: event.target.value })} required>
                        {[formData.product, ...formData.otherLabels].filter((label, index, all) => label && all.indexOf(label) === index).map((label) => <option key={label}>{label}</option>)}
                    </select>
                    <label>Quantity</label>
                    <input type="number" min="0" value={formData.quantity} onChange={(event) => setFormData({ ...formData, quantity: event.target.value })} required />
                    <label>Time</label><input value={formData.time} readOnly />
                    <label>Initials</label>
                    <input maxLength="5" value={formData.initials} onChange={(event) => setFormData({ ...formData, initials: event.target.value })} required />
                    <div className="button-group"><button className="confirm-btn">Confirm</button><button type="button" className="refresh-btn" onClick={fetchLatest}>Reload latest</button></div>
                </form>
            )}
        </main>
    );
}
