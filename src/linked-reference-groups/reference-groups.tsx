import React, {useEffect, useState} from 'react'
import {RoamEntity, Page as RoamPage} from 'roam-api-wrappers/dist/data'
import {
    CommonReferencesGrouper,
    defaultExclusions,
    defaultLowPriority,
    getGroupsForEntity,
    matchesFilter,
    mergeGroupsSmallerThan,
} from 'roam-api-wrappers/dist/data/collection'
import {Block} from '../components/block'
import {Button, Collapse} from '@blueprintjs/core'
import {SRSSignal, SRSSignals} from '../srs/scheduler'
import {rescheduleBlock} from '../srs'
import { createModifier, modifyDateInBlock, replaceDateInBlock, daysFromNow } from '../core/date'
import {MoveDateButtonProps} from '../date-panel'
import {delay} from '../core/async'
import {randomFromInterval} from '../core/random'
import {RoamDate} from 'roam-api-wrappers/dist/date'

interface ReferenceGroupProps {
    uid: string
    entities: RoamEntity[]
    rootPageUid: string
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

const SpreadButton = ({entities}: { entities: () => RoamEntity[] }) =>
    <Button className={'date-button'}
            title={'Spread items uniformly across the specified number of days'}
            onClick={() => {
                const daysStr = prompt('Choose the number of days to spread items through', '15')
                if (!daysStr) return
                const days = parseInt(daysStr)
                if (isNaN(days)) return

                entities().forEach(
                    ent => replaceDateInBlock(ent.uid, () => daysFromNow(randomFromInterval(1, days)))
                )
            }}
    >🎲</Button>

const getDateToRescheduleTo = (entity: RoamEntity, limit: number = 14) => {
    const groups = getGroupsForEntity(entity, {
        dontGroupReferencesTo: [...defaultExclusions, ...defaultLowPriority, /^wcs$/],
    }) // plausibly remove the low priority groups too?
    //todo maybe an additional setting
    const nextDay = new Date()

    const backlinkEntityReferencesGroup = (bl: RoamEntity, group: RoamEntity) =>
        bl.getLinkedEntities(true).some(it => it.uid === group.uid)

    for (let i = 0; i < limit; i++) {
        nextDay.setDate(nextDay.getDate() + 1)
        const backlinks = RoamPage.fromName(RoamDate.toRoam(nextDay))?.backlinks

        if (backlinks?.some(bl => groups.some(group => backlinkEntityReferencesGroup(bl, group)))) {
            return nextDay
        }
    }
    return nextDay
}

const NextDayWithThisGroupButton = ({entities}: { entities: () => RoamEntity[] }) => {
    // move all items in a group to a next day that has the items referencing this group present

    return <Button
        className={'date-button'}
        title={'Move all items in this group to the next day that has this group referenced'}
        onClick={() => entities().forEach(ent =>
            replaceDateInBlock(ent.uid, () => getDateToRescheduleTo(ent)))
        }
    >
        {'🧲'}
    </Button>
}

// Refreshing the entities from db to get latest data vs in-memory cache
const refreshEntities = (entities: RoamEntity[]) =>
  entities.map(it => RoamEntity.fromUid(it.uid)!)

function ReferenceGroup({uid, entities, rootPageUid}: ReferenceGroupProps) {
    const {isOpen, ToggleButton} = useTogglButton()

    const hasReferenceToRootPage = (ent: RoamEntity) =>
      ent.linkedEntities.some(it => it.uid === rootPageUid)
    const shouldBeRescheduled = (ent: RoamEntity) =>
      hasReferenceToRootPage(ent) &&
      matchesFilter(ent, RoamEntity.fromUid(rootPageUid)!.referenceFilter)

    const entitiesToReschedule = () => refreshEntities(entities).filter(shouldBeRescheduled)

    const MoveDateButton = ({shift, label}: MoveDateButtonProps) =>
        <Button className={'date-button'}
                onClick={() => {
                    entitiesToReschedule().forEach(
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
                            // deliberately using un-updated entities here for now 🤔
                            entities.forEach(ent => rescheduleBlock(ent.uid, sig))
                        }}
                    >
                        {SRSSignal[sig]}
                    </Button>)}

                    <SpreadButton entities={entitiesToReschedule} key="spread"/>
                    <NextDayWithThisGroupButton entities={entitiesToReschedule} key="next-day"/>
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
        if (event.altKey && event.ctrlKey && event.keyCode === 82) {
            updateRenderGroups(true)
            event.preventDefault()
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
            {renderGroups.length === 0 && <div>Calculating groups. If there are more then {dontGroupThreshold} backlinks - you need to manually press the refresh button.</div>}
            {renderGroups.map(([uid, entities]) =>
                <ReferenceGroup uid={uid} entities={entities} rootPageUid={entityUid} key={uid}/>)}
        </Collapse>
    </div>
}

ReferenceGroups.defaultProps = {
    smallestGroupSize: 2,
}
