export function checkBATNA(currentOffer, batnaValue, batnaDescription = '', perspective = 'seller') {
    const offerValue = typeof currentOffer?.value === 'number' ? currentOffer.value : null
    if (offerValue === null) return { breached: false, reason: null }
    const breached = perspective === 'seller' ? offerValue < batnaValue : offerValue > batnaValue
    if (breached) {
        return {
            breached: true,
            reason: `BATNA HARD STOP: Current offer of ${offerValue} breaches the BATNA floor of ${batnaValue}${batnaDescription ? ` (${batnaDescription})` : ''}. Claude API call blocked.`,
        }
    }
    return { breached: false, reason: null }
}
