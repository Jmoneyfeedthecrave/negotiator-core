/**
 * batnaEnforcer.js
 * Hard BATNA constraint checker. Called BEFORE every Claude API invocation.
 * If the current offer breaches BATNA, Claude is never called — this is an absolute hard stop.
 */

/**
 * Check whether the current offer breaches the BATNA floor.
 *
 * @param {object} currentOffer - JSONB object from world_model.current_offer
 *   Expected shape: { value: number, currency?: string, description?: string }
 * @param {number} batnaValue - The numeric BATNA threshold from configs.batna_value
 * @param {string} batnaDescription - Human-readable description for error messages
 * @param {'buyer'|'seller'} perspective - Whether we are the buyer (lower is better) or seller (higher is better)
 * @returns {{ breached: boolean, reason: string | null }}
 */
export function checkBATNA(currentOffer, batnaValue, batnaDescription = '', perspective = 'seller') {
    const offerValue = typeof currentOffer?.value === 'number' ? currentOffer.value : null

    // If no numeric offer yet, we cannot breach BATNA
    if (offerValue === null) {
        return { breached: false, reason: null }
    }

    let breached = false

    if (perspective === 'seller') {
        // Seller: we want HIGHER values. Breach if offer is BELOW BATNA.
        breached = offerValue < batnaValue
    } else {
        // Buyer: we want LOWER values. Breach if offer is ABOVE BATNA.
        breached = offerValue > batnaValue
    }

    if (breached) {
        return {
            breached: true,
            reason: `BATNA HARD STOP: Current offer of ${offerValue} breaches the BATNA floor of ${batnaValue}${batnaDescription ? ` (${batnaDescription})` : ''}. No further concessions permitted. Claude API call blocked.`,
        }
    }

    return { breached: false, reason: null }
}
