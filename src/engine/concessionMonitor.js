export function checkConcessionRate(turnHistory = [], concessionBudgetTotal = 20, concessionRemaining, turnsWindowForRateCheck = 3) {
    if (!turnHistory || turnHistory.length < 2) return { warning: false, rate: 0, budgetUsedPct: 0, flag: null }
    const budgetUsed = concessionBudgetTotal - concessionRemaining
    const budgetUsedPct = concessionBudgetTotal > 0 ? (budgetUsed / concessionBudgetTotal) * 100 : 0
    const recentTurns = turnHistory.slice(-turnsWindowForRateCheck)
    let totalConcessionInWindow = 0
    for (let i = 1; i < recentTurns.length; i++) {
        const prev = recentTurns[i - 1]?.our_offer?.value
        const curr = recentTurns[i]?.our_offer?.value
        if (typeof prev === 'number' && typeof curr === 'number') totalConcessionInWindow += Math.abs(curr - prev)
    }
    const rate = recentTurns.length > 1 ? totalConcessionInWindow / (recentTurns.length - 1) : 0
    const halfway = concessionBudgetTotal / 2
    const overMidpointEarly = budgetUsed > halfway && turnHistory.length <= 4
    const rateTooHigh = rate > (concessionRemaining * 0.3)
    const warning = overMidpointEarly || rateTooHigh
    const flag = warning
        ? `⚠ CONCESSION RATE WARNING: ${budgetUsedPct.toFixed(1)}% of concession budget used over ${turnHistory.length} turns (rate: ${rate.toFixed(2)} units/turn). ${concessionRemaining.toFixed(1)}% budget remaining. SLOW DOWN.`
        : null
    return { warning, rate, budgetUsedPct, flag }
}
