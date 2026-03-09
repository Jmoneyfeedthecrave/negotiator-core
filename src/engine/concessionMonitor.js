/**
 * concessionMonitor.js
 * Monitors the rate of concessions across turn history and flags over-conceding.
 * If flagged, a warning string is injected into the Claude system prompt.
 */

/**
 * Analyse turn history and flag if the agent is conceding too fast.
 *
 * @param {Array} turnHistory - JSONB array from world_model.turn_history
 *   Each entry: { turn: number, our_offer: { value: number }, counterparty_offer: { value: number }, ... }
 * @param {number} concessionBudgetTotal - Total concession budget percentage from configs (e.g. 20 means 20%)
 * @param {number} concessionRemaining - How much of the budget is left (from world_model.concession_remaining)
 * @param {number} turnsWindowForRateCheck - How many recent turns to evaluate rate over (default 3)
 * @returns {{ warning: boolean, rate: number, budgetUsedPct: number, flag: string | null }}
 */
export function checkConcessionRate(
    turnHistory = [],
    concessionBudgetTotal = 20,
    concessionRemaining,
    turnsWindowForRateCheck = 3
) {
    if (!turnHistory || turnHistory.length < 2) {
        return { warning: false, rate: 0, budgetUsedPct: 0, flag: null }
    }

    // Budget used
    const budgetUsed = concessionBudgetTotal - concessionRemaining
    const budgetUsedPct = concessionBudgetTotal > 0 ? (budgetUsed / concessionBudgetTotal) * 100 : 0

    // Rate over recent window: how many concession units per turn
    const recentTurns = turnHistory.slice(-turnsWindowForRateCheck)
    let totalConcessionInWindow = 0

    for (let i = 1; i < recentTurns.length; i++) {
        const prev = recentTurns[i - 1]?.our_offer?.value
        const curr = recentTurns[i]?.our_offer?.value
        if (typeof prev === 'number' && typeof curr === 'number') {
            // Positive delta means we moved toward the counterparty (conceded)
            totalConcessionInWindow += Math.abs(curr - prev)
        }
    }
    const rate = recentTurns.length > 1 ? totalConcessionInWindow / (recentTurns.length - 1) : 0

    // Trigger warning if:
    // - Over 50% of total budget used in early turns (first half of expected negotiation), OR
    // - Concession rate is high relative to remaining budget
    const halfway = concessionBudgetTotal / 2
    const overMidpointEarly = budgetUsed > halfway && turnHistory.length <= 4
    const rateTooHigh = rate > (concessionRemaining * 0.3) // single move used >30% of remaining

    const warning = overMidpointEarly || rateTooHigh

    const flag = warning
        ? `⚠ CONCESSION RATE WARNING: ${budgetUsedPct.toFixed(1)}% of concession budget used over ${turnHistory.length} turns (rate: ${rate.toFixed(2)} units/turn). ${concessionRemaining.toFixed(1)}% budget remaining. SLOW DOWN. Do not concede on this turn without extracting a meaningful counter-concession first.`
        : null

    return { warning, rate, budgetUsedPct, flag }
}
