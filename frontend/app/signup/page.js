"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function getApiUrl() {
    if (typeof window === "undefined") return "http://localhost:8000";
    if (window.location.hostname === "localhost") return "http://localhost:8000";
    return "https://syncroom-joth.onrender.com";
}

export default function SignupPage() {
    const router = useRouter();
    const [form, setForm] = useState({ email: "", password: "", display_name: "" });
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        if (!form.email.trim() || !form.password.trim() || !form.display_name.trim()) {
            setError("All fields are required");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`${getApiUrl()}/api/auth/signup`, {
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
                            : "Signup failed"
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
                <div className="auth-card-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: '#5865f2' }}>
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
                    </svg>
                </div>
                <h1>Create Account</h1>
                <p className="auth-subtitle">Join SyncRoom — watch videos with friends</p>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Display Name</label>
                        <input
                            type="text"
                            placeholder="What should we call you?"
                            value={form.display_name}
                            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                            maxLength={50}
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label>Email</label>
                        <input
                            type="email"
                            placeholder="you@example.com"
                            value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <input
                            type="password"
                            placeholder="At least 6 characters"
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
                        {loading ? "Creating..." : "Create Account →"}
                    </button>
                </form>

                <p className="auth-switch">
                    Already have an account?{" "}
                    <a href="/login" className="auth-link">
                        Log in
                    </a>
                </p>
            </div>
        </div>
    );
}
