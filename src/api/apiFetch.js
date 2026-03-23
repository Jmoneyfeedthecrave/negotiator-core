/**
 * Central API fetch helper
 * Automatically injects the ARCHI API key header on every request.
 * Set VITE_ARCHI_API_KEY in your .env (dev) and Netlify env vars (prod).
 * If the key is not set, requests go through unauthenticated (dev-safe).
 */

const API_KEY = import.meta.env.VITE_ARCHI_API_KEY

export async function apiFetch(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(API_KEY ? { 'x-archi-api-key': API_KEY } : {}),
        ...options.headers,  // allow caller to override
    }

    const res = await fetch(path, { ...options, headers })

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `${path} returned ${res.status}`)
    }

    return res.json()
}
