import {SRSSignal} from './scheduler'
import {AnkiAttentionScheduler, AnkiScheduler} from './AnkiScheduler'
import {Block} from 'roam-api-wrappers/dist/data'
import {SM2Node} from './SM2Node'

export function rescheduleBlock(blockUid: string, signal: SRSSignal) {
    // todo make this configurable (knowledge vs attention)
    const scheduler = new AnkiAttentionScheduler()
    const block = Block.fromUid(blockUid)
    block.text = scheduler.schedule(new SM2Node(block.text), signal).text
}
