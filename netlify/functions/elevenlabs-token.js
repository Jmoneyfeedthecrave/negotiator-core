/**
 * Netlify Function: elevenlabs-token
 * GET /api/elevenlabs-token
 * Returns a signed conversation URL for the ElevenLabs Conversational AI WebSocket.
 * Signed URL keeps the API key server-side — never exposed to the browser.
 */

import { serviceError, errResponse, requireAuth } from './fnUtils.js'

const AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_0901kc9sw5z5edmt9g7c04snwn0z'

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-archi-api-key, Authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }, body: '' }
    }
    const authErr = requireAuth(event); if (authErr) return authErr
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
        return errResponse(serviceError('elevenlabs', 'ELEVENLABS_API_KEY not configured'))
    }

    try {
        const res = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${AGENT_ID}`,
            { headers: { 'xi-api-key': apiKey } }
        )
        if (!res.ok) {
            const text = await res.text()
            return errResponse(serviceError('elevenlabs', `Signed URL fetch failed (${res.status}): ${text}`))
        }
        const { signed_url } = await res.json()
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signed_url }),
        }
    } catch (err) {
        return errResponse(serviceError('elevenlabs', 'Signed URL request failed', err))
    }
}
