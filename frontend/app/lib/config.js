/**
 * Backend origin resolution, shared by every client component.
 *
 * Priority:
 *   1. NEXT_PUBLIC_API_URL          — explicit override (use this in prod)
 *   2. same-host dev port 8000      — covers localhost *and* LAN IPs, so a
 *                                     phone on http://192.168.x.x:3000 talks to
 *                                     the same backend as the desktop
 *   3. hosted production API
 */

const DEV_API_PORT = process.env.NEXT_PUBLIC_API_PORT || "8000";
const PROD_API_URL = "https://syncroom-api.onrender.com";

const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/;
const PRIVATE_LAN = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function getApiUrl() {
    const configured = process.env.NEXT_PUBLIC_API_URL;
    if (configured) return configured.replace(/\/+$/, "");

    if (typeof window === "undefined") return `http://localhost:${DEV_API_PORT}`;

    const { hostname, protocol } = window.location;
    if (PRIVATE_HOST.test(hostname) || PRIVATE_LAN.test(hostname)) {
        return `${protocol}//${hostname}:${DEV_API_PORT}`;
    }
    return PROD_API_URL;
}

export function getWsUrl() {
    return getApiUrl().replace(/^http/, "ws");
}
