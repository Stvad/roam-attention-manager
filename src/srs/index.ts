import {SRSSignal, SRSSignals} from './scheduler'
import {AnkiAttentionScheduler, AnkiScheduler} from './AnkiScheduler'
import {Block} from 'roam-api-wrappers/dist/data'
import {SM2Node} from './SM2Node'
import hotkeys from 'hotkeys-js'

export function rescheduleBlock(blockUid: string, signal: SRSSignal) {
    // todo make this configurable (knowledge vs attention)
    const scheduler = new AnkiAttentionScheduler()
    const block = Block.fromUid(blockUid)
    block.text = scheduler.schedule(new SM2Node(block.text), signal).text
}

export const config = {
    id: 'srs',
    name: 'Spaced Repetition',
    settings: SRSSignals.map(it => ({
        type: 'shortcut',
        id: `srs_${SRSSignal[it]}`,
        label: `SRS: ${SRSSignal[it]}`,
        initValue: `ctrl+shift+${it}`,
        onPress: () => rescheduleCurrentNote(it),
    })),
}

export function rescheduleCurrentNote(signal: SRSSignal) {
    const currentBlockUid = window.roamAlphaAPI.ui.getFocusedBlock()?.['block-uid']
    if (!currentBlockUid) return

    rescheduleBlock(currentBlockUid, signal)
}

export const setup = () => {
    hotkeys.filter = function (event) {
        return true
    }

    config.settings.forEach(it => hotkeys(it.initValue, it.onPress))
}
