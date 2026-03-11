import { checkBATNA } from '../engine/batnaEnforcer.js'
import { checkConcessionRate } from '../engine/concessionMonitor.js'
import { runNegotiationTurn } from '../api/claudeClient.js'
import { getWorldModel } from '../api/worldModel.js'

export async function runTurn({ sessionId, counterpartyMessage, mode, config }) {
    const worldModel = await getWorldModel(sessionId)
    const perspective = config.variables?.perspective || 'seller'
    const batnaCheck = checkBATNA(worldModel.current_offer, config.batna_value, config.batna_description, perspective)
    if (batnaCheck.breached) return { type: 'batna_breach', reason: batnaCheck.reason, worldModel }
    const concessionFlag = checkConcessionRate(worldModel.turn_history, config.concession_budget, worldModel.concession_remaining)
    const result = await runNegotiationTurn({ sessionId, counterpartyMessage, mode, concessionFlag })
    return { type: mode === 'coached' ? 'coached_draft' : 'autonomous_response', result, concessionFlag, worldModel }
}
