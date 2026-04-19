/**
 * concessionMonitor.js
 * Checks the recent concession rate against the available budget and issues
 * warnings before the negotiator over-concedes.
 *
 * DFB-4 fix: concession_budget is stored as a raw currency unit (same units as
 * the offer values), NOT as a percentage. The old code mixed units by treating
 * it as a percentage in the warning label while subtracting raw currency amounts.
 * All math is now purely in offer-value units.
 */

export function checkConcessionRate(
    turnHistory = [],
    concessionBudgetTotal = 0,
    concessionRemaining = 0,
    turnsWindowForRateCheck = 3,
    perspective = 'seller',
) {
    if (!turnHistory || turnHistory.length < 2) {
        return { warning: false, rate: 0, budgetUsedPct: 0, flag: null }
    }

    const budgetUsed = concessionBudgetTotal - concessionRemaining
    // budgetUsedPct is for display only — always relative to total budget
    const budgetUsedPct = concessionBudgetTotal > 0 ? (budgetUsed / concessionBudgetTotal) * 100 : 0

    const recentTurns = turnHistory.slice(-turnsWindowForRateCheck)
    let totalConcessionInWindow = 0

    for (let i = 1; i < recentTurns.length; i++) {
        const prev = recentTurns[i - 1]?.our_offer?.value
        const curr = recentTurns[i]?.our_offer?.value
        if (typeof prev === 'number' && typeof curr === 'number') {
            // Directional: sellers concede down, buyers concede up
            const concession = perspective === 'buyer' ? curr - prev : prev - curr
            if (concession > 0) totalConcessionInWindow += concession
        }
    }

    const rate = recentTurns.length > 1 ? totalConcessionInWindow / (recentTurns.length - 1) : 0

    // Warn if: more than half the budget is spent in the first 4 turns,
    // or the per-turn concession rate exceeds 30% of remaining budget.
    const halfway = concessionBudgetTotal / 2
    const overMidpointEarly = budgetUsed > halfway && turnHistory.length <= 4
    const rateTooHigh = concessionRemaining > 0 && rate > (concessionRemaining * 0.3)
    const warning = overMidpointEarly || rateTooHigh

    const flag = warning
        ? `⚠ CONCESSION RATE WARNING: ${budgetUsedPct.toFixed(1)}% of budget used over ${turnHistory.length} turns (${rate.toFixed(2)} units/turn avg). ${concessionRemaining.toFixed(2)} units remaining. SLOW DOWN.`
        : null

    return { warning, rate, budgetUsedPct, flag }
}
