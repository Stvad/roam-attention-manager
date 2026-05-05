import {
    CommonReferencesGrouper,
    combineRegexes,
} from 'roam-api-wrappers/dist/data/collection'
import type {ReferenceGroupMap} from 'roam-api-wrappers/dist/data/collection'
import type {RoamEntity} from 'roam-api-wrappers/dist/data'
import type {ReferenceFilter} from 'roam-api-wrappers/dist/data/types'
import type {ReferenceGroupMetrics} from './metrics'

const GROUPING_ATTRIBUTE_NAMES = ['isa', 'group with']
const QUERY_CHUNK_SIZE = 500

type PulledRef = {
    uid?: string
    title?: string
    string?: string
    ':block/uid'?: string
    ':node/title'?: string
    ':block/string'?: string
} | null | undefined

type RefInfo = {
    uid: string
    text: string
    isPage: boolean
}

type RefRow = [string, PulledRef]
type AttributeRefRow = [string, number, PulledRef]

export type GroupedEntity = Pick<RoamEntity, 'uid'>

export type RenderedReferenceGroup = {
    uid: string
    title: string
    entities: GroupedEntity[]
}

type BuildReferenceGroupsOptions = {
    rootUid: string
    rootText: string
    backlinkUids: string[]
    dontGroupReferencesTo: RegExp[]
    highPriorityPages: RegExp[]
    lowPriorityPages: RegExp[]
    smallestGroupSize: number
    metrics?: ReferenceGroupMetrics
}

const q = <T extends unknown[]>(query: string, ...params: unknown[]): T[] =>
    (window.roamAlphaAPI.q(query, ...params) ?? []) as T[]

const unique = <T,>(items: T[]): T[] => [...new Set(items)]

const chunk = <T,>(items: T[], size: number): T[][] => {
    const chunks: T[][] = []
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size))
    }
    return chunks
}

const qByCollectionChunks = <T extends unknown[]>(query: string, values: string[], ...params: unknown[]): T[] =>
    chunk(values, QUERY_CHUNK_SIZE).flatMap(valueChunk => q<T>(query, valueChunk, ...params))

const measure = <T,>(metrics: ReferenceGroupMetrics | undefined, stage: string, fn: () => T, details?: Record<string, unknown>): T =>
    metrics ? metrics.measure(stage, fn, details) : fn()

const pulledUid = (ref: PulledRef): string => ref?.[':block/uid'] ?? ref?.uid ?? ''

const pulledTitle = (ref: PulledRef): string | undefined => ref?.[':node/title'] ?? ref?.title

const pulledText = (ref: PulledRef): string => pulledTitle(ref) ?? ref?.[':block/string'] ?? ref?.string ?? ''

const toRefInfo = (ref: PulledRef): RefInfo | null => {
    const uid = pulledUid(ref)
    const text = pulledText(ref)
    if (!uid || !text) return null

    return {uid, text, isPage: Boolean(pulledTitle(ref))}
}

const ROOT_BACKLINK_UIDS_QUERY = `
[:find ?uid
 :in $ ?rootUid
 :where
   [?root :block/uid ?rootUid]
   [?block :block/refs ?root]
   [?block :block/uid ?uid]]
`

const DIRECT_FILTER_REF_QUERY = `
[:find ?uid
 :in $ ?rootUid ?title
 :where
   [?root :block/uid ?rootUid]
   [?block :block/refs ?root]
   [?block :block/uid ?uid]
   [?ref :node/title ?title]
   [?block :block/refs ?ref]]
`

const PARENT_FILTER_REF_QUERY = `
[:find ?uid
 :in $ ?rootUid ?title
 :where
   [?root :block/uid ?rootUid]
   [?block :block/refs ?root]
   [?block :block/uid ?uid]
   [?ref :node/title ?title]
   [?block :block/parents ?parent]
   [?parent :block/refs ?ref]]
`

const PAGE_FILTER_REF_QUERY = `
[:find ?uid
 :in $ ?rootUid ?title
 :where
   [?root :block/uid ?rootUid]
   [?block :block/refs ?root]
   [?block :block/uid ?uid]
   [?ref :node/title ?title]
   [?block :block/page ?ref]]
`

const DIRECT_GROUP_REFS_QUERY = `
[:find ?blockUid (pull ?ref [:block/uid :node/title :block/string])
 :in $ [?blockUid ...]
 :where
   [?block :block/uid ?blockUid]
   [?block :block/refs ?ref]]
`

const PARENT_GROUP_REFS_QUERY = `
[:find ?blockUid (pull ?ref [:block/uid :node/title :block/string])
 :in $ [?blockUid ...]
 :where
   [?block :block/uid ?blockUid]
   [?block :block/parents ?parent]
   [?parent :block/refs ?ref]]
`

const PAGE_GROUP_REFS_QUERY = `
[:find ?blockUid (pull ?page [:block/uid :node/title :block/string])
 :in $ [?blockUid ...]
 :where
   [?block :block/uid ?blockUid]
   [?block :block/page ?page]]
`

const ATTRIBUTE_GROUP_REFS_QUERY = `
[:find ?baseUid ?order (pull ?ref [:block/uid :node/title :block/string])
 :in $ [?baseUid ...] ?prefix
 :where
   [?base :block/uid ?baseUid]
   [?base :block/children ?attributeBlock]
   [?attributeBlock :block/order ?order]
   [?attributeBlock :block/string ?attributeString]
   [(clojure.string/starts-with? ?attributeString ?prefix)]
   [?attributeBlock :block/refs ?ref]]
`

const PAGES_BY_TITLE_QUERY = `
[:find ?title (pull ?page [:block/uid :node/title])
 :in $ [?title ...]
 :where
   [?page :node/title ?title]]
`

const visibleRefUidsForFilterTitle = (rootUid: string, title: string, metrics?: ReferenceGroupMetrics): Set<string> => {
    const directRows = measure(metrics, 'filter direct refs query', () =>
        q<[string]>(DIRECT_FILTER_REF_QUERY, rootUid, title), {title})
    const parentRows = measure(metrics, 'filter parent refs query', () =>
        q<[string]>(PARENT_FILTER_REF_QUERY, rootUid, title), {title})
    const pageRows = measure(metrics, 'filter page refs query', () =>
        q<[string]>(PAGE_FILTER_REF_QUERY, rootUid, title), {title})
    const rows = [...directRows, ...parentRows, ...pageRows]
    const result = new Set(rows.map(([uid]) => uid))

    metrics?.mark('filter title result', {
        title,
        directRows: directRows.length,
        parentRows: parentRows.length,
        pageRows: pageRows.length,
        matchedBlocks: result.size,
    })

    return result
}

export const getFilteredBacklinkUids = (
    rootUid: string,
    filter: ReferenceFilter,
    metrics?: ReferenceGroupMetrics,
): string[] => {
    const allBacklinkUids = measure(metrics, 'root backlink uid query', () =>
        unique(q<[string]>(ROOT_BACKLINK_UIDS_QUERY, rootUid).map(([uid]) => uid)))

    metrics?.mark('reference filters', {
        backlinks: allBacklinkUids.length,
        includes: filter.includes.length,
        removes: filter.removes.length,
    })

    if (!filter.includes.length && !filter.removes.length) return allBacklinkUids

    const includeMatches = filter.includes.map(title => visibleRefUidsForFilterTitle(rootUid, title, metrics))
    const removeMatches = filter.removes.map(title => visibleRefUidsForFilterTitle(rootUid, title, metrics))

    return measure(metrics, 'apply filter sets', () =>
        allBacklinkUids.filter(uid =>
            includeMatches.every(matches => matches.has(uid)) &&
            removeMatches.every(matches => !matches.has(uid))), {
        backlinks: allBacklinkUids.length,
        includes: includeMatches.length,
        removes: removeMatches.length,
    })
}

const addMemberToGroup = (
    referenceGroups: LightweightReferenceGroupMap,
    groupTextByUid: Map<string, string>,
    group: RefInfo,
    member: GroupedEntity,
) => {
    const existingGroup = referenceGroups.get(group.uid)
    groupTextByUid.set(group.uid, group.text)

    if (existingGroup) {
        existingGroup.members.set(member.uid, member)
        return
    }

    referenceGroups.set(group.uid, {
        text: group.text,
        members: new Map([[member.uid, member]]),
    })
}

type LightweightReferenceGroupMap = Map<string, {
    text: string
    members: Map<string, GroupedEntity>
}>

const mergeGroupsSmallerThan = (
    referenceGroups: Map<string, GroupedEntity[]>,
    intoKey: string,
    minGroupSize: number,
    dontMerge: (uid: string) => boolean,
) => {
    const large: [string, GroupedEntity[]][] = []
    const mergedItems: GroupedEntity[] = []

    for (const [key, group] of referenceGroups) {
        if (!dontMerge(key) && (group.length < minGroupSize || key === intoKey)) {
            mergedItems.push(...group)
        } else {
            large.push([key, group])
        }
    }

    return new Map([...large, [intoKey, mergedItems]])
}

const queryBaseGroupRows = (backlinkUids: string[], metrics?: ReferenceGroupMetrics): RefRow[] => {
    const directRows = measure(metrics, 'group direct refs query', () =>
        qByCollectionChunks<RefRow>(DIRECT_GROUP_REFS_QUERY, backlinkUids), {backlinks: backlinkUids.length})
    const parentRows = measure(metrics, 'group parent refs query', () =>
        qByCollectionChunks<RefRow>(PARENT_GROUP_REFS_QUERY, backlinkUids), {backlinks: backlinkUids.length})
    const pageRows = measure(metrics, 'group page refs query', () =>
        qByCollectionChunks<RefRow>(PAGE_GROUP_REFS_QUERY, backlinkUids), {backlinks: backlinkUids.length})

    metrics?.mark('base ref rows', {
        directRows: directRows.length,
        parentRows: parentRows.length,
        pageRows: pageRows.length,
    })

    return [...directRows, ...parentRows, ...pageRows]
}

const addHierarchyGroups = (
    baseRefsByMemberUid: Map<string, Map<string, RefInfo>>,
    addGroupForMember: (memberUid: string, group: RefInfo) => void,
    metrics?: ReferenceGroupMetrics,
) => {
    const ancestorNamesByMemberAndRef = new Map<string, Map<string, string[]>>()
    const allAncestorNames = new Set<string>()

    for (const [memberUid, refsByUid] of baseRefsByMemberUid) {
        for (const ref of refsByUid.values()) {
            if (!ref.isPage || !ref.text.includes('/')) continue

            const ancestorNames = ref.text.split('/')
                .slice(0, -1)
                .map((_, index, parts) => parts.slice(0, index + 1).join('/'))

            if (!ancestorNames.length) continue

            let refsForMember = ancestorNamesByMemberAndRef.get(memberUid)
            if (!refsForMember) {
                refsForMember = new Map()
                ancestorNamesByMemberAndRef.set(memberUid, refsForMember)
            }

            refsForMember.set(ref.uid, ancestorNames)
            ancestorNames.forEach(name => allAncestorNames.add(name))
        }
    }

    if (!allAncestorNames.size) return

    const pageRows = measure(metrics, 'hierarchy ancestor page query', () =>
        qByCollectionChunks<[string, PulledRef]>(PAGES_BY_TITLE_QUERY, [...allAncestorNames]), {
        ancestorNames: allAncestorNames.size,
    })
    const pageByTitle = new Map(
        pageRows
            .map(([title, page]) => [title, toRefInfo(page)] as const)
            .filter((entry): entry is readonly [string, RefInfo] => Boolean(entry[1])),
    )

    metrics?.mark('hierarchy ancestor pages', {
        ancestorNames: allAncestorNames.size,
        foundPages: pageByTitle.size,
    })

    for (const [memberUid, refsForMember] of ancestorNamesByMemberAndRef) {
        for (const ancestorNames of refsForMember.values()) {
            ancestorNames.forEach(name => {
                const ancestor = pageByTitle.get(name)
                if (ancestor) addGroupForMember(memberUid, ancestor)
            })
        }
    }
}

const firstAttributeRefsByBaseUid = (rows: AttributeRefRow[]): Map<string, RefInfo[]> => {
    const firstOrderByBaseUid = new Map<string, number>()

    for (const [baseUid, order] of rows) {
        const existingOrder = firstOrderByBaseUid.get(baseUid)
        if (existingOrder === undefined || order < existingOrder) {
            firstOrderByBaseUid.set(baseUid, order)
        }
    }

    const result = new Map<string, Map<string, RefInfo>>()
    for (const [baseUid, order, pulledRef] of rows) {
        if (order !== firstOrderByBaseUid.get(baseUid)) continue

        const ref = toRefInfo(pulledRef)
        if (!ref) continue

        let refsByUid = result.get(baseUid)
        if (!refsByUid) {
            refsByUid = new Map()
            result.set(baseUid, refsByUid)
        }
        refsByUid.set(ref.uid, ref)
    }

    return new Map([...result].map(([baseUid, refsByUid]) => [baseUid, [...refsByUid.values()]]))
}

const addAttributeGroups = (
    baseRefsByMemberUid: Map<string, Map<string, RefInfo>>,
    addGroupForMember: (memberUid: string, group: RefInfo) => void,
    metrics?: ReferenceGroupMetrics,
) => {
    const memberUidsByBaseRefUid = new Map<string, Set<string>>()

    for (const [memberUid, refsByUid] of baseRefsByMemberUid) {
        for (const baseRefUid of refsByUid.keys()) {
            let memberUids = memberUidsByBaseRefUid.get(baseRefUid)
            if (!memberUids) {
                memberUids = new Set()
                memberUidsByBaseRefUid.set(baseRefUid, memberUids)
            }
            memberUids.add(memberUid)
        }
    }

    const baseRefUids = [...memberUidsByBaseRefUid.keys()]
    if (!baseRefUids.length) return

    for (const attributeName of GROUPING_ATTRIBUTE_NAMES) {
        const rows = measure(metrics, 'attribute refs query', () =>
            qByCollectionChunks<AttributeRefRow>(
                ATTRIBUTE_GROUP_REFS_QUERY,
                baseRefUids,
                `${attributeName}::`,
            ), {
            attributeName,
            baseRefs: baseRefUids.length,
        })
        const refsByBaseUid = firstAttributeRefsByBaseUid(rows)

        metrics?.mark('attribute refs result', {
            attributeName,
            rows: rows.length,
            baseRefsWithAttribute: refsByBaseUid.size,
        })

        for (const [baseUid, refs] of refsByBaseUid) {
            const memberUids = memberUidsByBaseRefUid.get(baseUid)
            if (!memberUids) continue

            for (const memberUid of memberUids) {
                refs
                    .filter(ref => ref.text !== attributeName)
                    .forEach(ref => addGroupForMember(memberUid, ref))
            }
        }
    }
}

export const buildReferenceGroupsWithDatalog = ({
    rootUid,
    rootText,
    backlinkUids,
    dontGroupReferencesTo,
    highPriorityPages,
    lowPriorityPages,
    smallestGroupSize,
    metrics,
}: BuildReferenceGroupsOptions): RenderedReferenceGroup[] => {
    const referenceGroups: LightweightReferenceGroupMap = new Map()
    const groupTextByUid = new Map<string, string>([[rootUid, rootText]])
    const combinedExclusion = combineRegexes(dontGroupReferencesTo)
    const notExcluded = (group: RefInfo) => !combinedExclusion?.test(group.text)

    const memberByUid = measure(metrics, 'initialize member uid map', () =>
        new Map<string, GroupedEntity>(unique(backlinkUids).map(uid => [uid, {uid}])), {
        backlinkUids: backlinkUids.length,
    })
    const baseRefsByMemberUid = new Map<string, Map<string, RefInfo>>()
    const memberUidsWithGroups = new Set<string>()

    const addGroupForMember = (memberUid: string, group: RefInfo) => {
        const member = memberByUid.get(memberUid)
        if (!member || !notExcluded(group)) return

        memberUidsWithGroups.add(memberUid)
        addMemberToGroup(referenceGroups, groupTextByUid, group, member)
    }

    measure(metrics, 'build base reference groups', () => {
        let skippedPulledRefs = 0
        for (const [memberUid, pulledRef] of queryBaseGroupRows([...memberByUid.keys()], metrics)) {
            const ref = toRefInfo(pulledRef)
            if (!ref) {
                skippedPulledRefs += 1
                continue
            }

            if (notExcluded(ref)) {
                let baseRefsByUid = baseRefsByMemberUid.get(memberUid)
                if (!baseRefsByUid) {
                    baseRefsByUid = new Map()
                    baseRefsByMemberUid.set(memberUid, baseRefsByUid)
                }
                baseRefsByUid.set(ref.uid, ref)
            }

            addGroupForMember(memberUid, ref)
        }

        metrics?.mark('base reference groups built', {
            groups: referenceGroups.size,
            membersWithBaseRefs: baseRefsByMemberUid.size,
            skippedPulledRefs,
        })
    })

    measure(metrics, 'add hierarchy groups', () =>
        addHierarchyGroups(baseRefsByMemberUid, addGroupForMember, metrics), {
        membersWithBaseRefs: baseRefsByMemberUid.size,
    })
    measure(metrics, 'add attribute groups', () =>
        addAttributeGroups(baseRefsByMemberUid, addGroupForMember, metrics), {
        uniqueBaseRefs: new Set([...baseRefsByMemberUid.values()].flatMap(refs => [...refs.keys()])).size,
    })

    measure(metrics, 'assign fallback group', () => {
        let fallbackMembers = 0
        for (const [memberUid, member] of memberByUid) {
            if (!memberUidsWithGroups.has(memberUid)) {
                fallbackMembers += 1
                addMemberToGroup(referenceGroups, groupTextByUid, {uid: rootUid, text: rootText, isPage: true}, member)
            }
        }
        metrics?.mark('fallback group assigned', {fallbackMembers})
    })

    const grouped = measure(metrics, 'deduplicate and sort groups', () =>
        new CommonReferencesGrouper(
            rootUid,
            dontGroupReferencesTo,
            {
                low: lowPriorityPages,
                high: highPriorityPages,
            },
        ).deduplicateAndSortGroups(referenceGroups as unknown as ReferenceGroupMap) as unknown as Map<string, GroupedEntity[]>, {
        candidateGroups: referenceGroups.size,
    })

    const mergedGroups = measure(metrics, 'merge small groups', () =>
        mergeGroupsSmallerThan(
            grouped,
            rootUid,
            smallestGroupSize,
            uid => highPriorityPages.some(pattern => pattern.test(groupTextByUid.get(uid) ?? '')),
        ), {
        groupsBeforeMerge: grouped.size,
        smallestGroupSize,
    })

    return measure(metrics, 'format render groups', () => [...mergedGroups.entries()].map(([uid, entities]) => ({
        uid,
        title: groupTextByUid.get(uid) ?? uid,
        entities,
    })), {
        groups: mergedGroups.size,
    })
}
