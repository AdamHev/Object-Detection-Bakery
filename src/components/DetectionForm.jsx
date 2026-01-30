import { useState, useEffect } from "react";
import axios from "axios";

export default function DetectionForm() {
    const [formData, setFormData] = useState(null);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState(null);

    // Function to process incoming detection data (from fetch or SSE)
    const processDetectionData = (data) => {
        if (!data || !Array.isArray(data.labels) || data.object_count === undefined || data.timestamp === undefined) {
            console.error("Received invalid data format:", data);
            setError("Received invalid data format from server.");
            return;
        }

        setFormData({
            product: data.labels[0] || "",
            otherLabels: data.labels.slice(1),
            quantity: data.object_count.toString(),
            time: data.timestamp,
            initials: formData?.initials || "",
        });
        setSubmitted(false); // New data arrived, reset submitted status
        setError(null);
    };


    // Fetch initial detection data on component mount
    const fetchInitialDetection = async () => {
        try {
            const res = await axios.get("http://localhost:3000/detection");
            console.log("Fetched initial detection:", res.data);
            processDetectionData(res.data);
        } catch (err) {
            if (err.response && err.response.status === 404) {
                console.log("No initial detection data available yet.");
                setError("No detection data available yet. Waiting for updates...");
            } else {
                console.error("Failed to fetch initial detection", err);
                setError("Failed to load initial data. Please check server connection.");
            }
        }
    };

    // Effect for initial fetch and setting up SSE
    useEffect(() => {
        // Fetch the current latest detection when the component mounts
        fetchInitialDetection();

        console.log("Setting up SSE connection...");
        const eventSource = new EventSource("http://localhost:3000/events");

        // Listener for messages from the server
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log("SSE received:", data);
                processDetectionData(data);
            } catch (parseError) {
                console.error("Failed to parse SSE data:", event.data, parseError);
                setError("Received malformed update from server.");
            }
        };

        // Listener for errors on the SSE connection
        eventSource.onerror = (err) => {
            console.error("EventSource failed:", err);
            setError("Connection error with server updates. Attempting to reconnect...");
        };

        return () => {
            console.log("Closing SSE connection.");
            eventSource.close();
        };

    }, []); // Empty dependency array ensures this runs only once on mount and cleans up on unmount

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData) return;

        const payload = {
            product: formData.product,
            quantity: Number(formData.quantity),
            time: formData.time,
            initials: formData.initials,
        };

        if (!payload.product || isNaN(payload.quantity) || !payload.time || !payload.initials) {
             setError("Please fill in all fields correctly.");
             return;
        }

        try {
            setError(null);
            await axios.post("http://localhost:3000/confirm", payload);
            setSubmitted(true);
            // Optionally clear initials or reset form after successful submission
            // setFormData(prev => ({ ...prev, initials: "" }));
        } catch (err) {
            console.error("Submission failed", err);
            setError(err.response?.data?.error || "Submission failed. Please try again.");
            setSubmitted(false);
        }
    };

    const handleManualRefresh = () => {
        console.log("Manual refresh requested.");
        setError(null);
        fetchInitialDetection();
    };


    return (
        <div className="detection-form-wrapper">
            <h2>Confirm Detection</h2>

            {error && <p className="error-msg">{error}</p>}
            {submitted && <p className="success-msg">Form submitted successfully!</p>}

            {!formData ? (
                <div>
                    <p>{error || "Loading detection data..."}</p>
                     <button className="refresh-btn" onClick={handleManualRefresh}>
                        Try Reload
                     </button>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="detection-form">
                    <label>Product:</label>
                    <select
                        value={formData.product}
                        onChange={(e) =>
                            setFormData({ ...formData, product: e.target.value })
                        }
                        required
                    >
                        {[formData.product, ...formData.otherLabels]
                          .filter((label, index, self) => label && self.indexOf(label) === index) // Filter out empty/duplicates
                          .map((label) => (
                            <option key={label} value={label}>
                                {label}
                            </option>
                        ))}
                         { (!formData.product && formData.otherLabels.length === 0) && <option value="" disabled>No labels detected</option> }
                    </select>

                    <label>Quantity:</label>
                    <input
                        type="number"
                        min="0"
                        value={formData.quantity}
                        onChange={(e) =>
                            setFormData({ ...formData, quantity: e.target.value })
                        }
                        required
                    />

                    <label>Time:</label>
                    <input
                        type="text"
                        value={formData.time}
                         onChange={(e) =>
                           setFormData({ ...formData, time: e.target.value })
                         }
                         readOnly
                        required
                    />

                    <label>Initials:</label>
                    <input
                        type="text"
                        maxLength="5"
                        value={formData.initials}
                        onChange={(e) =>
                            setFormData({ ...formData, initials: e.target.value })
                        }
                        required
                    />

                    <div className="button-group">
                        <button type="submit" className="confirm-btn">Confirm</button>
                        <button type="button" className="refresh-btn" onClick={handleManualRefresh}>
                            Reload Latest
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}