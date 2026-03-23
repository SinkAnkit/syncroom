"use client";

import { Component } from "react";

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
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
                        <p style={{ color: "#888", marginBottom: 16, fontSize: "0.9rem" }}>
                            {this.state.error?.message || "An unexpected error occurred"}
                        </p>
                        <button
                            onClick={() => {
                                this.setState({ hasError: false, error: null });
                                window.location.reload();
                            }}
                            style={{
                                padding: "10px 24px",
                                background: "#7c5cfc",
                                color: "white",
                                border: "none",
                                borderRadius: "8px",
                                cursor: "pointer",
                                fontSize: "0.9rem",
                            }}
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
