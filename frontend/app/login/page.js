"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function getApiUrl() {
    if (typeof window === "undefined") return "http://localhost:8000";
    if (window.location.hostname === "localhost") return "http://localhost:8000";
    return "https://syncroom-joth.onrender.com";
}

export default function LoginPage() {
    const router = useRouter();
    const [form, setForm] = useState({ email: "", password: "" });
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        if (!form.email.trim() || !form.password.trim()) {
            setError("All fields are required");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`${getApiUrl()}/api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(
                    typeof data.detail === "string"
                        ? data.detail
                        : Array.isArray(data.detail)
                            ? data.detail.map((e) => e.msg).join(", ")
                            : "Login failed"
                );
            }

            const data = await res.json();
            localStorage.setItem("syncroom_token", data.access_token);
            localStorage.setItem("syncroom_user", JSON.stringify(data.user));
            router.push("/");
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-card-icon">🔑</div>
                <h1>Welcome Back</h1>
                <p className="auth-subtitle">Log in to your SyncRoom account</p>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Email</label>
                        <input
                            type="email"
                            placeholder="you@example.com"
                            value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <input
                            type="password"
                            placeholder="••••••••"
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                        />
                    </div>

                    {error && <p className="form-error">{error}</p>}

                    <button
                        type="submit"
                        className="btn-primary"
                        style={{ width: "100%", justifyContent: "center" }}
                        disabled={loading}
                    >
                        {loading ? "Logging in..." : "Log In →"}
                    </button>
                </form>

                <p className="auth-switch">
                    Don't have an account?{" "}
                    <a href="/signup" className="auth-link">
                        Sign up
                    </a>
                </p>
            </div>
        </div>
    );
}
