import React, {useState} from 'react'

import {Classes, Dialog} from '@blueprintjs/core'

import {createModifier, modifyDateInBlock} from './core/date'
import {SRSSignal, SRSSignals} from './srs/scheduler'
import {Block} from 'roam-api-wrappers/dist/data'
import {SM2Node} from './srs/SM2Node'

import './date-panel.css'
import {delay} from './core/async'
import {createOverlayRender} from 'roamjs-components/util'
import {rescheduleBlock} from './srs'
import {migrateBlockToMemo, showMigrationToast, MigrationResult} from './srs/migrate-to-memo'

export type DatePanelProps = {
    blockUid: string
}

export interface MoveDateButtonProps {
    shift: number
    label: string
}

function getFirstDate(blockUid: string) {
    const date = new SM2Node(Block.fromUid(blockUid).text).listDates()[0]
    if (!date) return "No date"

    return date.toLocaleDateString('en-US',
        {weekday: 'short', year: 'numeric', month: 'long', day: 'numeric'})

}

const migrationResultMessages: Record<MigrationResult, {message: string, intent: 'success' | 'warning' | 'danger'}> = {
    'success': {message: 'Migrated to roam/memo', intent: 'success'},
    'not-found': {message: 'No roam-toolkit metadata found', intent: 'warning'},
    'already-exists': {message: 'Already migrated to roam/memo', intent: 'warning'},
    'error': {message: 'Migration failed — check console', intent: 'danger'},
}

const MigrateToMemoButton = ({blockUid}: {blockUid: string}) => {
    const [migrated, setMigrated] = useState(false)

    return <button
        className={"date-button migrate-memo-button" + (migrated ? ' migrated' : '')}
        disabled={migrated}
        onClick={async () => {
            const result = await migrateBlockToMemo(blockUid)
            const {message, intent} = migrationResultMessages[result]
            showMigrationToast(message, intent)
            if (result === 'success' || result === 'already-exists') setMigrated(true)
        }}
    >
        {migrated ? '✅' : '📦'}
    </button>
}

export const DatePanel = ({blockUid, onClose}: { onClose: () => void; } & DatePanelProps) => {
    const [date, setDate] = useState<string>(getFirstDate(blockUid))

    async function updateDate() {
        await delay(0)
        setDate(getFirstDate(blockUid))
    }

    const MoveDateButton = ({shift, label}: MoveDateButtonProps) =>
        <button className={"date-button"}
                onClick={async () => {
                    modifyDateInBlock(blockUid, createModifier(shift), true)
                    await updateDate()
                }}
        >
            {label}
        </button>


    return <Dialog
        isOpen={true}
        onClose={onClose}
        canEscapeKeyClose
        backdropClassName={"date-dialog-backdrop"}
        className={"date-dialog"}
    >
        <div className={Classes.DIALOG_BODY + " date-dialog-body"}>
            <h1 className={"date-under-edit"}>{date}</h1>

            <div className="buttons">
                <div className="day-buttons date-buttons">
                    <MoveDateButton shift={1} label={"+1d"}/>
                    <MoveDateButton shift={-1} label={"-1d"}/>
                </div>

                <div className="week-buttons date-buttons">
                    <MoveDateButton shift={7} label={"+1w"}/>
                    <MoveDateButton shift={-7} label={"-1w"}/>
                </div>

                <h3 className={"date-dialog-header"}>SRS</h3>
                <div className="srs-buttons date-buttons">
                    {SRSSignals.map(it => <button
                        className={"srs-button date-button"}
                        onClick={async () => {
                            rescheduleBlock(blockUid, it)
                            await updateDate()
                        }}
                        key={it}
                    >
                        {SRSSignal[it]}
                    </button>)}
                    <MigrateToMemoButton blockUid={blockUid}/>
                </div>
            </div>
        </div>
    </Dialog>
}

export const DatePanelOverlay = createOverlayRender<DatePanelProps>("date-overlay", DatePanel)
