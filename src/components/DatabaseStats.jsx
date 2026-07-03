import { useEffect, useState } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;
const percent = (value) => value == null ? "—" : `${(Number(value) * 100).toFixed(1)}%`;

export default function DatabaseStats() {
    const [statistics, setStatistics] = useState(null);
    const [error, setError] = useState("");

    useEffect(() => {
        axios.get(`${API_BASE}/statistics`)
            .then(({ data }) => setStatistics(data))
            .catch(() => setError("Could not load database statistics."));
    }, []);

    if (error) return <p className="error-msg">{error}</p>;
    if (!statistics) return <p className="stats-loading">Loading statistics...</p>;

    const { totals, corrections, models, recent_reviews: recentReviews } = statistics;
    const largestCorrection = Math.max(...corrections.map(({ count }) => count), 1);

    return (
        <section className="database-stats">
            <div className="stat-grid">
                <article><strong>{totals.detections}</strong><span>Detections</span></article>
                <article><strong>{totals.predictions}</strong><span>Objects predicted</span></article>
                <article><strong>{totals.reviews}</strong><span>Reviews</span></article>
                <article><strong>{totals.pending_reviews}</strong><span>Awaiting review</span></article>
                <article><strong>{percent(totals.average_confidence)}</strong><span>Avg. confidence</span></article>
                <article><strong>{percent(totals.review_accuracy)}</strong><span>Accepted unchanged</span></article>
            </div>

            <div className="stats-columns">
                <div className="stats-card">
                    <h3>Review outcomes</h3>
                    {corrections.length === 0 ? <p>No reviews yet.</p> : corrections.map((item) => (
                        <div className="correction-row" key={item.correction_type}>
                            <div><span>{item.correction_type.replace("_", " ")}</span><b>{item.count}</b></div>
                            <div className="bar-track"><i style={{ width: `${(item.count / largestCorrection) * 100}%` }} /></div>
                        </div>
                    ))}
                </div>

                <div className="stats-card">
                    <h3>Model versions</h3>
                    {models.length === 0 ? <p>No model data yet.</p> : (
                        <div className="table-scroll"><table><thead><tr><th>Model</th><th>Runs</th><th>Reviewed</th><th>Confidence</th></tr></thead>
                            <tbody>{models.map((model) => <tr key={model.model_version}><td>{model.model_version}</td><td>{model.detections}</td><td>{model.reviewed}</td><td>{percent(model.average_confidence)}</td></tr>)}</tbody>
                        </table></div>
                    )}
                </div>
            </div>

            <div className="stats-card recent-reviews">
                <h3>Recent reviews</h3>
                {recentReviews.length === 0 ? <p>No reviews yet.</p> : (
                    <div className="table-scroll"><table><thead><tr><th>Captured</th><th>Product</th><th>Predicted</th><th>Corrected</th><th>Outcome</th><th>Reviewer</th></tr></thead>
                        <tbody>{recentReviews.map((review) => <tr key={`${review.detection_id}-${review.reviewed_at}`}><td>{review.captured_at}</td><td>{review.corrected_product}</td><td>{review.predicted_count}</td><td>{review.corrected_count}</td><td><span className={`outcome outcome-${review.correction_type}`}>{review.correction_type.replace("_", " ")}</span></td><td>{review.reviewer_initials}</td></tr>)}</tbody>
                    </table></div>
                )}
            </div>
        </section>
    );
}
