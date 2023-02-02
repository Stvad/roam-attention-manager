import React, {useEffect, useState} from 'react'
import {RoamEntity} from 'roam-api-wrappers/dist/data'
import {
    defaultExclusions,
    groupByMostCommonReferences,
    matchesFilter,
} from 'roam-api-wrappers/dist/data/collection'
import {Block} from '../components/block'
import {Button, Collapse} from '@blueprintjs/core'
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

export const useTogglButton = () => {
    const [isOpen, setIsOpen] = useState(true)
    const ToggleButton = () =>
        <Button
            icon={isOpen ? 'chevron-down' : 'chevron-right'}
            onClick={() => setIsOpen(!isOpen)}
        />
    return {isOpen, ToggleButton}
}

function ReferenceGroup({uid, entities}: ReferenceGroupProps) {
    const {isOpen, ToggleButton} = useTogglButton()
    const MoveDateButton = ({shift, label}: MoveDateButtonProps) =>
        <Button className={'date-button'}
                onClick={() => {
                    entities.forEach(
                        ent => modifyDateInBlock(ent.uid, createModifier(shift)))
                }}
        >
            {label}
        </Button>

    return <div
        className="reference-group"
        css={{
            marginTop: '1em',
        }}
    >
        <div
            className="reference-group-header"
            css={{
                display: 'flex',
            }}
        >
            <ToggleButton/>
            <div>{RoamEntity.fromUid(uid)?.text} ({entities.length})</div>
        </div>

        <Collapse isOpen={isOpen} keepChildrenMounted={true} transitionDuration={0}>
            <div className={'reference-group-controls'}>
                <div className="srs-buttons date-buttons">
                    <MoveDateButton shift={1} label={'+1d'}/>
                    <MoveDateButton shift={-1} label={'-1d'}/>

                    {SRSSignals.map(sig => <Button
                        className={'srs-button date-button'}
                        onClick={async () => {
                            // todo double check if it's still referencing the main page, ignore if not
                            entities.forEach(ent => rescheduleBlock(ent.uid, sig))
                        }}
                    >
                        {SRSSignal[sig]}
                    </Button>)}
                </div>
            </div>

            <div className="reference-group-entities">
                {entities.map(entity =>
                    <div className={'rm-reference-item'}>
                        <Block uid={entity.uid} key={entity.uid}/>
                    </div>)}
            </div>
        </Collapse>
    </div>
}

export function ReferenceGroups({entityUid, smallestGroupSize}: ReferenceGroupsProps) {
    const {isOpen, ToggleButton} = useTogglButton()
    const [renderGroups, setRenderGroups] = useState<[string, RoamEntity[]][]>([])
    // todo remember collapse state in local storage

    // todo also have a shortcut for refresh
    function updateRenderGroups(refresh: boolean = false) {
        const entity = RoamEntity.fromUid(entityUid)
        if (!entity) return

        const backlinks = entity.backlinks.filter(it => matchesFilter(it, entity.referenceFilter))
        // todo this is ugly?
        if (backlinks.length > 150 && !refresh) return

        // todo filter before grouping
        const groups = groupByMostCommonReferences(backlinks, [...defaultExclusions, new RegExp(`^${entity.text}$`)])
        // expose possible/hidden groups to user in ux and allow them to select which ones to render
        console.log({groups})
        setRenderGroups(Array.from(groups.entries())
            .filter(([_, entries]) => entries.length >= smallestGroupSize))
    }

    useEffect(() => {
        // const tooManyBacklinks = (RoamEntity.fromUid(entityUid)?.backlinks.length ?? 0) > 150
        // if (tooManyBacklinks)  return

        updateRenderGroups()
    }, [entityUid, smallestGroupSize])
    // todo loading indicator
    // todo if no groups are matching the size limit - show special message
    return <div
        className="reference-group-container"
        css={{
            [`[data-link-uid="${entityUid}"]`]: {
                backgroundColor: '#bce5d385',
                borderRadius: '4px',
            },
        }}
    >
        <div
            className="reference-groups-header"
            css={{
                display: 'flex',
            }}
        >
            <ToggleButton/>
            <div>References grouped by most common pages</div>
            <Button icon={'refresh'} onClick={() => updateRenderGroups(true)}/>
        </div>

        <Collapse
            isOpen={isOpen}
            keepChildrenMounted={true}
            transitionDuration={0}
            css={{
                marginLeft: '0.5em',
            }}
        >
            {renderGroups.map(([uid, entities]) =>
                <ReferenceGroup uid={uid} entities={entities} key={uid}/>)}
        </Collapse>
    </div>
}

ReferenceGroups.defaultProps = {
    smallestGroupSize: 1,
}
