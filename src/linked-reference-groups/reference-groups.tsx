import React, {useEffect, useState} from 'react'
import {RoamEntity} from 'roam-api-wrappers/dist/data'
import {defaultExclusions, groupByMostCommonReferences} from 'roam-api-wrappers/dist/data/collection'
import {Block} from '../components/block'
import {Button} from '@blueprintjs/core'
import {SRSSignal, SRSSignals} from '../srs/scheduler'
import {rescheduleBlock} from '../srs'
import {createModifier, modifyDateInBlock} from '../core/date'
import {MoveDateButtonProps} from '../date-panel'

interface ReferenceGroupsProps {
    entityUid: string
    smallestGroupSize: number
}

interface ReferenceGroupProps {
    uid: string
    entities: RoamEntity[]
}


function ReferenceGroup({uid, entities}: ReferenceGroupProps) {
    const MoveDateButton = ({shift, label}: MoveDateButtonProps) =>
        <Button className={"date-button"}
                onClick={ () => {
                    entities.forEach(
                        ent => modifyDateInBlock(ent.uid, createModifier(shift)))
                }}
        >
            {label}
        </Button>

    return <div className="reference-group" key={uid}>
        <div className="reference-group-header">
            <div>{RoamEntity.fromUid(uid).text} ({entities.length})</div>
            <div className={"reference-group-controls"}>


                <div className="srs-buttons date-buttons">
                    <MoveDateButton shift={1} label={"+1d"}/>
                    <MoveDateButton shift={-1} label={"-1d"}/>

                    {SRSSignals.map(sig => <Button
                        className={"srs-button date-button"}
                        onClick={async () => {
                            // todo double check if it's still referencing the main page, ignore if not
                            entities.forEach(ent => rescheduleBlock(ent.uid, sig))
                        }}
                    >
                        {SRSSignal[sig]}
                    </Button>)}
                </div>
            </div>
        </div>
        <div className="reference-group-entities">
            {entities.map(entity => <Block uid={entity.uid} key={entity.uid}/>)}
        </div>
    </div>
}

export function ReferenceGroups({entityUid, smallestGroupSize}: ReferenceGroupsProps) {
    const [renderGroups, setRenderGroups] = useState<[string, RoamEntity[]][]>([])
    // todo groups it collapsible and remember the state in local storage
    // todo refresh button

    function updateRenderGroups(refresh: boolean = false) {
        const entity = RoamEntity.fromUid(entityUid)
        const backlincks = entity?.backlinks
        // todo this is ugly?
        if (backlincks.length > 150 && !refresh) return

        // todo filter before grouping
        const groups = groupByMostCommonReferences(backlincks, [...defaultExclusions, new RegExp(`^${entity.text}$`)])
        // expose possible/hidden groups to user in ux and allow them to select which ones to render
        console.log({groups})
        setRenderGroups(Array.from(groups.entries()).filter(([_, entries]) => entries.length >= smallestGroupSize))
    }

    useEffect(() => {
        updateRenderGroups()
    }, [entityUid, smallestGroupSize])
    // todo loading indicator
    // todo if no groups are matching the size limit - show special message
    return <div className="reference-group-container">
        <div className="reference-groups-header">
            <div>References grouped by most common pages</div>
            <Button icon={'refresh'} onClick={() => updateRenderGroups(true)}/>
        </div>
        {renderGroups.map(([uid, entities]) =>
            <ReferenceGroup uid={uid} entities={entities} key={uid}/>)}
    </div>
}

ReferenceGroups.defaultProps = {
    smallestGroupSize: 3,
}
