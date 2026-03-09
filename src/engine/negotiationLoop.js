/**
 * negotiationLoop.js
 * Orchestrates one complete negotiation turn on the frontend.
 * Enforces BATNA, checks concession rate, calls the /api/negotiate Netlify function.
 * Mode-aware: Coached = returns response for human approval. Autonomous = returns directly.
 */

import { checkBATNA } from '../engine/batnaEnforcer.js'
import { checkConcessionRate } from '../engine/concessionMonitor.js'
import { runNegotiationTurn } from '../api/claudeClient.js'
import { getWorldModel } from '../api/worldModel.js'

/**
 * Run one full negotiation turn.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.counterpartyMessage
 * @param {'coached'|'autonomous'} params.mode
 * @param {object} params.config - configs row (for BATNA, budget, perspective)
 * @returns {Promise<object>} Turn result: { type, result } or { type: 'batna_breach', reason }
 */
export async function runTurn({ sessionId, counterpartyMessage, mode, config }) {
    // 1. Load current world model state
    const worldModel = await getWorldModel(sessionId)

    // 2. BATNA hard check — must happen before Claude is ever called
    const perspective = config.variables?.perspective || 'seller'
    const batnaCheck = checkBATNA(
        worldModel.current_offer,
        config.batna_value,
        config.batna_description,
        perspective
    )

    if (batnaCheck.breached) {
        return {
            type: 'batna_breach',
            reason: batnaCheck.reason,
            worldModel,
        }
    }

    // 3. Concession rate check — flag injected into prompt if triggered
    const concessionFlag = checkConcessionRate(
        worldModel.turn_history,
        config.concession_budget,
        worldModel.concession_remaining
    )

    // 4. Call the Netlify negotiate function (Claude API lives here, server-side)
    const result = await runNegotiationTurn({
        sessionId,
        counterpartyMessage,
        mode,
        concessionFlag, // sent along for the server to include in systemPromptBuilder
    })

    return {
        type: mode === 'coached' ? 'coached_draft' : 'autonomous_response',
        result,
        concessionFlag,
        worldModel,
    }
}
