import React, {useEffect, useState} from 'react'
import {RoamEntity, Page as RoamPage} from 'roam-api-wrappers/dist/data'
import {
    CommonReferencesGrouper,
    defaultExclusions,
    defaultLowPriority,
    matchesFilter,
    mergeGroupsSmallerThan,
} from 'roam-api-wrappers/dist/data/collection'
import {Block} from '../components/block'
import {Button, Collapse} from '@blueprintjs/core'
import {SRSSignal, SRSSignals} from '../srs/scheduler'
import {rescheduleBlock} from '../srs'
import {createModifier, modifyDateInBlock, replaceDateInBlock} from '../core/date'
import {MoveDateButtonProps} from '../date-panel'
import {delay} from '../core/async'
import {randomFromInterval} from '../core/random'
import {RoamDate} from 'roam-api-wrappers/dist/date'

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

const SpreadButton = ({entities}: { entities: RoamEntity[] }) =>
    <Button className={'date-button'}
            title={'Spread items uniformly across the specified number of days'}
            onClick={() => {
                const daysStr = prompt('Choose the number of days to spread items through', '15')
                if (!daysStr) return
                const days = parseInt(daysStr)
                if (isNaN(days)) return

                entities.forEach(
                    ent => modifyDateInBlock(ent.uid, createModifier(randomFromInterval(1, days))))
            }}
    >🎲</Button>

function getDateToRescheduleTo(groupUid: string, limit = 10) {
    const nextDay = new Date()
    for (let i = 0; i < limit; i++) {
        nextDay.setDate(nextDay.getDate() + 1)
        console.log("checking", nextDay)
        const backlinks = RoamPage.fromName(RoamDate.toRoam(nextDay))?.backlinks
        console.log({backlinks: backlinks?.map(it => it.text)})

        if (backlinks?.some(it => it.getLinkedEntities(true).some(it => it.uid === groupUid))) {
            return nextDay
        }
    }
    return nextDay
}

const NextDayWithThisGroupButton = ({entities, groupUid}: { entities: RoamEntity[], groupUid: string }) => {
    // move all items in a group to a next day that has the items referencing this group present

    return <Button
        className={'date-button'}
        title={'Move all items in this group to the next day that has this group referenced'}
        onClick={
            () => {
                const newDate = getDateToRescheduleTo(groupUid)
                console.log({newDate})

                entities.forEach(ent => replaceDateInBlock(ent.uid, () => newDate))
            }
        }
    >
        {'🧲'}
    </Button>
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

    // todo: before doing batch actions - apply reference filters & check if this is still has a link to original page
    // to handle rescheduled & "done" items
    // also these don't really make sense outside of the daily notes pages
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
                <div className="date-buttons">
                    <MoveDateButton shift={1} label={'+1d'} key="+1"/>
                    <MoveDateButton shift={-1} label={'-1d'} key="-1"/>

                    {SRSSignals.slice(1).map(sig => <Button
                        className={'srs-button date-button'}
                        key={sig}
                        onClick={async () => {
                            // todo double check if it's still referencing the main page, ignore if not
                            entities.forEach(ent => rescheduleBlock(ent.uid, sig))
                        }}
                    >
                        {SRSSignal[sig]}
                    </Button>)}

                    <SpreadButton entities={entities} key="spread"/>
                    <NextDayWithThisGroupButton entities={entities} groupUid={uid} key="next-day"/>
                </div>
            </div>

            <div className="reference-group-entities">
                {entities.map(entity =>
                    <div className={'rm-reference-item'} key={entity.uid}>
                        <Block uid={entity.uid} key={entity.uid}/>
                    </div>)}
            </div>
        </Collapse>
    </div>
}

interface ReferenceGroupsProps {
    entityUid: string
    smallestGroupSize: number
    highPriorityPages: RegExp[]
    lowPriorityPages: RegExp[]
    dontGroupThreshold?: number
}

export function ReferenceGroups(
    {
        entityUid,
        smallestGroupSize,
        highPriorityPages,
        lowPriorityPages,
        dontGroupThreshold = 150,
    }: ReferenceGroupsProps) {
    const {isOpen, ToggleButton} = useTogglButton()
    const [renderGroups, setRenderGroups] = useState<[string, RoamEntity[]][]>([])
    // todo remember collapse state in local storage

    // todo also have a shortcut for refresh
    function updateRenderGroups(refresh: boolean = false) {
        const entity = RoamEntity.fromUid(entityUid)
        if (!entity) {
            console.error(`${entityUid} entity not found`)
            return
        }

        const backlinks = entity.backlinks.filter(it => matchesFilter(it, entity.referenceFilter))
        // todo this is ugly?
        if (backlinks.length > dontGroupThreshold && !refresh) {
            console.warn(`Too many backlinks (${backlinks.length}) for ${entityUid} - skipping initial render.
             Click refresh to render anyway.`)
            return
        }

        const groups = new CommonReferencesGrouper(
            entityUid,
            [...defaultExclusions, new RegExp(`^${entity.text}$`)],
            {
                low: lowPriorityPages,
                high: highPriorityPages,
            }).group(backlinks)

        const mergedGroups = mergeGroupsSmallerThan(
            groups,
            entityUid,
            smallestGroupSize,
            uid => highPriorityPages.some(it => it.test(RoamEntity.fromUid(uid)?.text ?? '')),
        )
        console.log({mergedGroups})
        setRenderGroups(Array.from(mergedGroups.entries()))
    }

    const updateReferenceGroupsShortcutHandler = (event: KeyboardEvent) => {
        if (event.altKey && event.metaKey && event.keyCode === 82) {
            updateRenderGroups(true)
        }
    }

    useEffect(() => {
        (async () => {
            await delay(0)
            updateRenderGroups()
            document.addEventListener('keydown', updateReferenceGroupsShortcutHandler)
        })()

        return () => {
            document.removeEventListener('keydown', updateReferenceGroupsShortcutHandler)
        }
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
    smallestGroupSize: 2,
}
