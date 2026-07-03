import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import DatabaseStats from "./DatabaseStats";

const API_BASE = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;

function formatTimestamp(timestamp) {
    const match = String(timestamp).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    return match ? `${match[1]} ${match[2]}` : timestamp;
}

export default function DetectionForm() {
    const [formData, setFormData] = useState(null);
    const [showDetection, setShowDetection] = useState(false);
    const [showDatabase, setShowDatabase] = useState(false);
    const [submitted, setSubmitted] = useState("");
    const [error, setError] = useState(null);

    const processDetectionData = useCallback((data) => {
        if (!data?.id || !Array.isArray(data.labels) || !Array.isArray(data.confidences) || !data.image_url) {
            setError("The server returned an invalid detection.");
            return;
        }
        setFormData((previous) => ({
            detectionId: data.id,
            product: data.labels[0] || "",
            otherLabels: data.labels.slice(1),
            quantity: String(data.object_count),
            time: formatTimestamp(data.timestamp),
            initials: previous?.initials || "",
            notes: "",
            confidences: data.confidences,
            labels: data.labels,
            modelVersion: data.model_version,
            imageUrl: `${API_BASE}${data.image_url}`,
        }));
        setSubmitted("");
        setError(null);
    }, []);

    const fetchLatest = useCallback(async () => {
        try {
            processDetectionData((await axios.get(`${API_BASE}/detection`)).data);
        } catch (requestError) {
            setError(requestError.response?.status === 404
                ? "No detection yet. Waiting for the Raspberry Pi..."
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
        events.onerror = () => setError("Live connection interrupted; reconnecting...");
        return () => events.close();
    }, [fetchLatest, processDetectionData]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            const response = await axios.post(`${API_BASE}/confirm`, {
                detection_id: formData.detectionId,
                product: formData.product,
                quantity: Number(formData.quantity),
                initials: formData.initials,
                notes: formData.notes,
            });
            setSubmitted(`Review saved as: ${response.data.correction_type.replace("_", " ")}.`);
            setError(null);
        } catch (requestError) {
            setError(requestError.response?.data?.error || "Confirmation failed.");
        }
    };

    const averageConfidence = formData?.confidences.length
        ? formData.confidences.reduce((sum, value) => sum + value, 0) / formData.confidences.length
        : null;
    const productOptions = formData
        ? [formData.product, ...formData.otherLabels].filter((label, index, all) => label && all.indexOf(label) === index)
        : [];

    return (
        <main className="detection-form-wrapper">
            <div className="card-header">
                <div><span className="eyebrow">Live review</span><h2>Confirm Detection</h2></div>
                <div className="header-actions">
                    <button className="database-btn" onClick={() => { setShowDatabase((visible) => !visible); setShowDetection(false); }}>
                        {showDatabase ? "Hide database" : "Database"}
                    </button>
                    <button className="detection-btn" disabled={!formData} onClick={() => { setShowDetection((visible) => !visible); setShowDatabase(false); }}>
                        {showDetection ? "Hide detection" : "Detection"}
                    </button>
                </div>
            </div>

            {error && <p className="error-msg">{error}</p>}
            {submitted && <p className="success-msg">{submitted}</p>}

            {showDatabase && <DatabaseStats />}

            {showDetection && formData && (
                <section className="detection-preview">
                    <img src={formData.imageUrl} alt="Latest annotated bakery detection" />
                    <div className="confidence-summary">
                        <strong>{averageConfidence === null ? "—" : `${(averageConfidence * 100).toFixed(1)}%`}</strong>
                        <span>Average confidence</span>
                        <small>Model: {formData.modelVersion}</small>
                    </div>
                    <ul>{formData.labels.map((label, index) => <li key={`${label}-${index}`}><span>{label}</span><b>{((formData.confidences[index] || 0) * 100).toFixed(1)}%</b></li>)}</ul>
                </section>
            )}

            {!showDatabase && (!formData ? <button className="refresh-btn" onClick={fetchLatest}>Try again</button> : (
                <form onSubmit={handleSubmit} className="detection-form">
                    <label>Product</label>
                    <input list="detected-products" value={formData.product} onChange={(event) => setFormData({ ...formData, product: event.target.value })} required />
                    <datalist id="detected-products">{productOptions.map((label) => <option key={label} value={label} />)}</datalist>
                    <label>Quantity</label>
                    <input type="number" min="0" value={formData.quantity} onChange={(event) => setFormData({ ...formData, quantity: event.target.value })} required />
                    <label>Time</label><input value={formData.time} readOnly />
                    <label>Initials</label>
                    <input maxLength="5" value={formData.initials} onChange={(event) => setFormData({ ...formData, initials: event.target.value })} required />
                    <label>Notes</label>
                    <textarea placeholder="Optional: what was missed or duplicated?" value={formData.notes} onChange={(event) => setFormData({ ...formData, notes: event.target.value })} />
                    <div className="button-group"><button className="confirm-btn">Confirm</button><button type="button" className="refresh-btn" onClick={fetchLatest}>Reload latest</button></div>
                </form>
            ))}
        </main>
    );
}
