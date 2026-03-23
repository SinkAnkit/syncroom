"use client";

export default function GlobalError({ error, reset }) {
    return (
        <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            background: "#0a0a0f",
            color: "#e0e0e0",
            fontFamily: "system-ui, sans-serif",
            padding: "24px",
        }}>
            <div style={{ textAlign: "center", maxWidth: 500 }}>
                <h1 style={{ fontSize: "1.5rem", marginBottom: 12 }}>Something went wrong</h1>
                <p style={{ color: "#888", marginBottom: 8, fontSize: "0.9rem" }}>
                    {error?.message || "An unexpected error occurred"}
                </p>
                <p style={{ color: "#555", marginBottom: 20, fontSize: "0.75rem", fontFamily: "monospace" }}>
                    {error?.stack?.split("\n")[0] || ""}
                </p>
                <button
                    onClick={() => reset()}
                    style={{
                        padding: "10px 24px",
                        background: "#7c5cfc",
                        color: "white",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "0.9rem",
                        marginRight: 8,
                    }}
                >
                    Try Again
                </button>
                <button
                    onClick={() => window.location.href = "/"}
                    style={{
                        padding: "10px 24px",
                        background: "transparent",
                        color: "#7c5cfc",
                        border: "1px solid #7c5cfc",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "0.9rem",
                    }}
                >
                    Go Home
                </button>
            </div>
        </div>
    );
}
