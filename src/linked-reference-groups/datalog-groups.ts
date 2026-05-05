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
    order?: number
    refs?: PulledRef[]
    children?: PulledRef[]
    ':block/uid'?: string
    ':node/title'?: string
    ':block/string'?: string
    ':block/order'?: number
    ':block/refs'?: PulledRef[]
    ':block/children'?: PulledRef[]
} | null | undefined

type RefInfo = {
    uid: string
    text: string
    isPage: boolean
}

type RefRow = [string, PulledRef]
type FilterRefRow = [string, string]
type CountRow = [number]
type RootBacklinkRow = [string, PulledRef]
type RootBacklinkBaseRefRow = [string, string, string, PulledRef]
type AttributeRefRow = [string, string, number, PulledRef]
type AttributeBaseRow = [string, PulledRef]
type FilteredBacklinkData = {
    backlinkUids: string[]
    backlinkPageByUid: Map<string, RefInfo>
    baseGroupRows?: RefRow[]
}

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
    backlinkPageByUid?: Map<string, RefInfo>
    baseGroupRows?: RefRow[]
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

const pulledOrder = (ref: PulledRef): number => ref?.[':block/order'] ?? ref?.order ?? Number.POSITIVE_INFINITY

const pulledRefs = (ref: PulledRef): PulledRef[] => ref?.[':block/refs'] ?? ref?.refs ?? []

const pulledChildren = (ref: PulledRef): PulledRef[] => ref?.[':block/children'] ?? ref?.children ?? []

const toRefInfo = (ref: PulledRef): RefInfo | null => {
    const uid = pulledUid(ref)
    const text = pulledText(ref)
    if (!uid || !text) return null

    return {uid, text, isPage: Boolean(pulledTitle(ref))}
}

const ROOT_BACKLINK_UIDS_QUERY = `
[:find ?uid (pull ?page [:block/uid :node/title])
 :in $ ?rootUid
 :where
   [?root :block/uid ?rootUid]
   [?block :block/refs ?root]
   [?block :block/uid ?uid]
   [?block :block/page ?page]]
`

const ROOT_BACKLINK_COUNT_QUERY = `
[:find (count ?block)
 :in $ ?rootUid
 :where
   [?root :block/uid ?rootUid]
   [?block :block/refs ?root]]
`

const DIRECT_FILTER_REF_QUERY = `
[:find ?title ?uid
 :in $ ?rootUid [?title ...]
 :where
   [?root :block/uid ?rootUid]
   [?block :block/refs ?root]
   [?block :block/uid ?uid]
   [?ref :node/title ?title]
   [?block :block/refs ?ref]]
`

const PARENT_FILTER_REF_QUERY = `
[:find ?title ?uid
 :in $ ?rootUid [?title ...]
 :where
   [?root :block/uid ?rootUid]
   [?block :block/refs ?root]
   [?block :block/uid ?uid]
   [?ref :node/title ?title]
   [?block :block/parents ?parent]
   [?parent :block/refs ?ref]]
`

const PAGE_FILTER_REF_QUERY = `
[:find ?title ?uid
 :in $ ?rootUid [?title ...]
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

const COMBINED_GROUP_REFS_QUERY = `
[:find ?blockUid (pull ?ref [:block/uid :node/title :block/string])
 :in $ [?blockUid ...]
 :where
   [?block :block/uid ?blockUid]
   (or-join [?block ?ref]
     [?block :block/refs ?ref]
     (and
       [?block :block/parents ?parent]
       [?parent :block/refs ?ref]))]
`

const ROOT_COMBINED_GROUP_REFS_QUERY = `
[:find ?blockUid (pull ?ref [:block/uid :node/title :block/string])
 :in $ ?rootUid
 :where
   [?root :block/uid ?rootUid]
   [?block :block/refs ?root]
   [?block :block/uid ?blockUid]
   (or-join [?block ?ref]
     [?block :block/refs ?ref]
     (and
       [?block :block/parents ?parent]
       [?parent :block/refs ?ref]))]
`

const ROOT_BACKLINK_BASE_REFS_QUERY = `
[:find ?blockUid ?pageUid ?pageTitle (pull ?ref [:block/uid :node/title :block/string])
 :in $ ?rootUid
 :where
   [?root :block/uid ?rootUid]
   [?block :block/refs ?root]
   [?block :block/uid ?blockUid]
   [?block :block/page ?page]
   [?page :block/uid ?pageUid]
   [?page :node/title ?pageTitle]
   (or-join [?block ?ref]
     [?block :block/refs ?ref]
     (and
       [?block :block/parents ?parent]
       [?parent :block/refs ?ref]))]
`

const PAGE_GROUP_REFS_QUERY = `
[:find ?blockUid (pull ?page [:block/uid :node/title])
 :in $ [?blockUid ...]
 :where
   [?block :block/uid ?blockUid]
   [?block :block/page ?page]]
`

const ATTRIBUTE_GROUP_REFS_QUERY = `
[:find ?prefix ?baseUid ?order (pull ?ref [:block/uid :node/title :block/string])
 :in $ [?baseUid ...] [?prefix ...]
 :where
   [?base :block/uid ?baseUid]
   [?base :block/children ?attributeBlock]
   [?attributeBlock :block/order ?order]
   [?attributeBlock :block/string ?attributeString]
   [(clojure.string/starts-with? ?attributeString ?prefix)]
   [?attributeBlock :block/refs ?ref]]
`

const ATTRIBUTE_BASE_PULL_QUERY = `
[:find ?baseUid (pull ?base [:block/uid :node/title :block/string
                             {:block/children [:block/uid :block/string :block/order
                                               {:block/refs [:block/uid :node/title :block/string]}]}])
 :in $ [?baseUid ...]
 :where
   [?base :block/uid ?baseUid]]
`

const PAGES_BY_TITLE_QUERY = `
[:find ?title (pull ?page [:block/uid :node/title])
 :in $ [?title ...]
 :where
   [?page :node/title ?title]]
`

const refRowsByTitle = (rows: FilterRefRow[]): Map<string, Set<string>> => {
    const result = new Map<string, Set<string>>()
    for (const [title, uid] of rows) {
        let refsForTitle = result.get(title)
        if (!refsForTitle) {
            refsForTitle = new Set()
            result.set(title, refsForTitle)
        }
        refsForTitle.add(uid)
    }
    return result
}

const mergeTitleRefRows = (...maps: Map<string, Set<string>>[]): Map<string, Set<string>> => {
    const result = new Map<string, Set<string>>()

    for (const map of maps) {
        for (const [title, uids] of map) {
            let refsForTitle = result.get(title)
            if (!refsForTitle) {
                refsForTitle = new Set()
                result.set(title, refsForTitle)
            }
            uids.forEach(uid => refsForTitle!.add(uid))
        }
    }

    return result
}

const visibleRefUidsByFilterTitle = (
    rootUid: string,
    titles: string[],
    backlinkPageByUid?: Map<string, RefInfo>,
    metrics?: ReferenceGroupMetrics,
): Map<string, Set<string>> => {
    if (!titles.length) return new Map()

    const directRows = measure(metrics, 'filter direct refs query', () =>
        q<FilterRefRow>(DIRECT_FILTER_REF_QUERY, rootUid, titles), {titles: titles.length})
    const parentRows = measure(metrics, 'filter parent refs query', () =>
        q<FilterRefRow>(PARENT_FILTER_REF_QUERY, rootUid, titles), {titles: titles.length})
    const pageRows = backlinkPageByUid
        ? measure(metrics, 'filter cached page refs', () =>
            filterPageRowsFromBacklinkPages(titles, backlinkPageByUid), {
            titles: titles.length,
            backlinks: backlinkPageByUid.size,
        })
        : measure(metrics, 'filter page refs query', () =>
            q<FilterRefRow>(PAGE_FILTER_REF_QUERY, rootUid, titles), {titles: titles.length})
    const result = mergeTitleRefRows(
        refRowsByTitle(directRows),
        refRowsByTitle(parentRows),
        refRowsByTitle(pageRows),
    )

    metrics?.mark('filter title results', {
        titles: titles.length,
        directRows: directRows.length,
        parentRows: parentRows.length,
        pageRows: pageRows.length,
        pageRowsSource: backlinkPageByUid ? 'root backlink query' : 'query',
        titlesWithMatches: result.size,
        matchedBlocks: new Set([...result.values()].flatMap(uids => [...uids])).size,
    })

    return result
}

const filterPageRowsFromBacklinkPages = (
    titles: string[],
    backlinkPageByUid: Map<string, RefInfo>,
): FilterRefRow[] => {
    const wantedTitles = new Set(titles)
    return [...backlinkPageByUid.entries()]
        .filter(([, page]) => wantedTitles.has(page.text))
        .map(([uid, page]) => [page.text, uid] as FilterRefRow)
}

const visibleRefUidsByCachedBaseRows = (
    titles: string[],
    baseGroupRows: RefRow[],
    backlinkPageByUid: Map<string, RefInfo>,
    metrics?: ReferenceGroupMetrics,
): Map<string, Set<string>> => {
    const wantedTitles = new Set(titles)
    const {refRows, pageRows} = measure(metrics, 'filter cached base refs', () => ({
        refRows: baseGroupRows
            .map(([uid, pulledRef]) => [uid, toRefInfo(pulledRef)] as const)
            .filter((entry): entry is readonly [string, RefInfo] => {
                const ref = entry[1]
                return ref !== null && wantedTitles.has(ref.text)
            })
            .map(([uid, ref]) => [ref.text, uid] as FilterRefRow),
        pageRows: filterPageRowsFromBacklinkPages(titles, backlinkPageByUid),
    }), {
        titles: titles.length,
        baseRows: baseGroupRows.length,
        backlinks: backlinkPageByUid.size,
    })
    const result = mergeTitleRefRows(
        refRowsByTitle(refRows),
        refRowsByTitle(pageRows),
    )

    metrics?.mark('filter title results', {
        titles: titles.length,
        baseRows: refRows.length,
        pageRows: pageRows.length,
        baseRowsSource: 'group refs query',
        pageRowsSource: 'root backlink query',
        titlesWithMatches: result.size,
        matchedBlocks: new Set([...result.values()].flatMap(uids => [...uids])).size,
    })

    return result
}

const buildBacklinksFromBaseRows = (rows: RootBacklinkBaseRefRow[]): FilteredBacklinkData => {
    const backlinkUids = unique(rows.map(([uid]) => uid))
    const backlinkPageByUid = new Map<string, RefInfo>()

    rows.forEach(([uid, pageUid, pageTitle]) => {
        if (pageUid && pageTitle) {
            backlinkPageByUid.set(uid, {uid: pageUid, text: pageTitle, isPage: true})
        }
    })

    return {
        backlinkUids,
        backlinkPageByUid,
        baseGroupRows: rows.map(([uid, , , pulledRef]) => [uid, pulledRef] as RefRow),
    }
}

const queryRootBacklinks = (
    rootUid: string,
    metrics?: ReferenceGroupMetrics,
): FilteredBacklinkData => {
    const rootBacklinkRows = measure(metrics, 'root backlink uid query', () =>
        q<RootBacklinkRow>(ROOT_BACKLINK_UIDS_QUERY, rootUid))
    const backlinkUids = unique(rootBacklinkRows.map(([uid]) => uid))
    const backlinkPageByUid = new Map<string, RefInfo>()
    rootBacklinkRows.forEach(([uid, pulledPage]) => {
        const page = toRefInfo(pulledPage)
        if (page) backlinkPageByUid.set(uid, page)
    })

    return {
        backlinkUids,
        backlinkPageByUid,
    }
}

const queryRootBacklinkCount = (
    rootUid: string,
    metrics?: ReferenceGroupMetrics,
): number => measure(metrics, 'root backlink count query', () =>
    q<CountRow>(ROOT_BACKLINK_COUNT_QUERY, rootUid)[0]?.[0] ?? 0, {rootUid})

const queryRootBacklinksWithBaseRefs = (
    rootUid: string,
    expectedBacklinks: number,
    metrics?: ReferenceGroupMetrics,
): FilteredBacklinkData | null => {
    const rows = measure(metrics, 'root backlink base refs query', () =>
        q<RootBacklinkBaseRefRow>(ROOT_BACKLINK_BASE_REFS_QUERY, rootUid), {rootUid})
    const backlinks = buildBacklinksFromBaseRows(rows)

    metrics?.mark('root backlink base refs result', {
        backlinks: backlinks.backlinkUids.length,
        expectedBacklinks,
        pages: backlinks.backlinkPageByUid.size,
        baseRows: backlinks.baseGroupRows?.length ?? 0,
    })

    if (backlinks.backlinkUids.length !== expectedBacklinks) {
        metrics?.mark('root backlink base refs mismatch', {
            backlinks: backlinks.backlinkUids.length,
            expectedBacklinks,
        })
        return null
    }

    metrics?.mark('base ref rows', {
        groupRows: backlinks.baseGroupRows?.length ?? 0,
        pageRows: 0,
        groupRowsSource: 'root backlink base refs query',
        pageRowsSource: 'root backlink base refs query',
    })

    return backlinks
}

const filterBacklinks = (
    rootUid: string,
    backlinks: FilteredBacklinkData,
    filter: ReferenceFilter,
    metrics?: ReferenceGroupMetrics,
): FilteredBacklinkData => {
    metrics?.mark('reference filters', {
        backlinks: backlinks.backlinkUids.length,
        pages: backlinks.backlinkPageByUid.size,
        includes: filter.includes.length,
        removes: filter.removes.length,
    })

    if (!filter.includes.length && !filter.removes.length) {
        return backlinks
    }

    const filterTitles = unique([...filter.includes, ...filter.removes])
    const matchesByTitle = backlinks.baseGroupRows
        ? visibleRefUidsByCachedBaseRows(
            filterTitles,
            backlinks.baseGroupRows,
            backlinks.backlinkPageByUid,
            metrics,
        )
        : visibleRefUidsByFilterTitle(rootUid, filterTitles, backlinks.backlinkPageByUid, metrics)
    const includeMatches = filter.includes.map(title => matchesByTitle.get(title) ?? new Set<string>())
    const removeMatches = filter.removes.map(title => matchesByTitle.get(title) ?? new Set<string>())

    const filteredBacklinkUids = measure(metrics, 'apply filter sets', () =>
        backlinks.backlinkUids.filter(uid =>
            includeMatches.every(matches => matches.has(uid)) &&
            removeMatches.every(matches => !matches.has(uid))), {
        backlinks: backlinks.backlinkUids.length,
        includes: includeMatches.length,
        removes: removeMatches.length,
    })
    const filteredBacklinkUidSet = new Set(filteredBacklinkUids)

    return {
        backlinkUids: filteredBacklinkUids,
        backlinkPageByUid: new Map(filteredBacklinkUids
            .map(uid => [uid, backlinks.backlinkPageByUid.get(uid)] as const)
            .filter((entry): entry is readonly [string, RefInfo] => Boolean(entry[1]))),
        baseGroupRows: backlinks.baseGroupRows?.filter(([uid]) => filteredBacklinkUidSet.has(uid)),
    }
}

export const getFilteredBacklinkUids = (
    rootUid: string,
    filter: ReferenceFilter,
    metrics?: ReferenceGroupMetrics,
): string[] => {
    return getFilteredBacklinks(rootUid, filter, metrics).backlinkUids
}

export const getFilteredBacklinks = (
    rootUid: string,
    filter: ReferenceFilter,
    metrics?: ReferenceGroupMetrics,
): FilteredBacklinkData => filterBacklinks(rootUid, queryRootBacklinks(rootUid, metrics), filter, metrics)

export const getFilteredBacklinksWithBaseRefs = (
    rootUid: string,
    filter: ReferenceFilter,
    metrics?: ReferenceGroupMetrics,
    maxPrefetchBacklinks: number = Number.POSITIVE_INFINITY,
): FilteredBacklinkData => {
    const backlinkCount = queryRootBacklinkCount(rootUid, metrics)
    if (backlinkCount > maxPrefetchBacklinks) {
        metrics?.mark('base refs prefetch skipped', {
            backlinks: backlinkCount,
            maxPrefetchBacklinks,
        })
        const backlinks = queryRootBacklinks(rootUid, metrics)
        return filterBacklinks(rootUid, backlinks, filter, metrics)
    }

    const prefetchedBacklinks = queryRootBacklinksWithBaseRefs(rootUid, backlinkCount, metrics)
    if (prefetchedBacklinks) {
        return filterBacklinks(rootUid, prefetchedBacklinks, filter, metrics)
    }

    const backlinks = queryRootBacklinks(rootUid, metrics)
    const baseGroupRows = queryRootBaseGroupRows(rootUid, metrics) ??
        queryBaseGroupRows(backlinks.backlinkUids, metrics, false)
    return filterBacklinks(rootUid, {
        ...backlinks,
        baseGroupRows,
    }, filter, metrics)
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

let useCombinedGroupRefsQuery = true
let useRootCombinedGroupRefsQuery = true

const queryPageGroupRows = (
    backlinkUids: string[],
    metrics?: ReferenceGroupMetrics,
): RefRow[] => measure(metrics, 'group page refs query', () =>
    qByCollectionChunks<RefRow>(PAGE_GROUP_REFS_QUERY, backlinkUids), {backlinks: backlinkUids.length})

const querySeparateBaseGroupRows = (
    backlinkUids: string[],
    metrics?: ReferenceGroupMetrics,
    includePageRefs: boolean = true,
): RefRow[] => {
    const directRows = measure(metrics, 'group direct refs query', () =>
        qByCollectionChunks<RefRow>(DIRECT_GROUP_REFS_QUERY, backlinkUids), {backlinks: backlinkUids.length})
    const parentRows = measure(metrics, 'group parent refs query', () =>
        qByCollectionChunks<RefRow>(PARENT_GROUP_REFS_QUERY, backlinkUids), {backlinks: backlinkUids.length})
    const pageRows = includePageRefs ? queryPageGroupRows(backlinkUids, metrics) : []

    metrics?.mark('base ref rows', {
        directRows: directRows.length,
        parentRows: parentRows.length,
        pageRows: pageRows.length,
        groupRowsSource: 'separate queries',
        pageRowsSource: includePageRefs ? 'query' : 'root backlink query',
    })

    return [...directRows, ...parentRows, ...pageRows]
}

const queryRootBaseGroupRows = (
    rootUid: string,
    metrics?: ReferenceGroupMetrics,
): RefRow[] | null => {
    if (!useRootCombinedGroupRefsQuery) return null

    try {
        const groupRows = measure(metrics, 'group root combined refs query', () =>
            q<RefRow>(ROOT_COMBINED_GROUP_REFS_QUERY, rootUid), {rootUid})

        metrics?.mark('base ref rows', {
            groupRows: groupRows.length,
            pageRows: 0,
            groupRowsSource: 'root combined query',
            pageRowsSource: 'root backlink query',
        })

        return groupRows
    } catch (error) {
        useRootCombinedGroupRefsQuery = false
        const message = error instanceof Error ? error.message : String(error)
        metrics?.mark('group root combined refs query failed', {message})
        console.warn('[roam-date reference groups] root combined group refs query failed; falling back to uid query', error)
        return null
    }
}

const queryBaseGroupRows = (
    backlinkUids: string[],
    metrics?: ReferenceGroupMetrics,
    includePageRefs: boolean = true,
): RefRow[] => {
    if (!useCombinedGroupRefsQuery) {
        return querySeparateBaseGroupRows(backlinkUids, metrics, includePageRefs)
    }

    try {
        const groupRows = measure(metrics, 'group combined refs query', () =>
            qByCollectionChunks<RefRow>(COMBINED_GROUP_REFS_QUERY, backlinkUids), {backlinks: backlinkUids.length})
        const pageRows = includePageRefs ? queryPageGroupRows(backlinkUids, metrics) : []

        metrics?.mark('base ref rows', {
            groupRows: groupRows.length,
            pageRows: pageRows.length,
            groupRowsSource: 'combined query',
            pageRowsSource: includePageRefs ? 'query' : 'root backlink query',
        })

        return [...groupRows, ...pageRows]
    } catch (error) {
        useCombinedGroupRefsQuery = false
        const message = error instanceof Error ? error.message : String(error)
        metrics?.mark('group combined refs query failed', {message})
        console.warn('[roam-date reference groups] combined group refs query failed; falling back to separate queries', error)
        return querySeparateBaseGroupRows(backlinkUids, metrics, includePageRefs)
    }
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

    for (const [, baseUid, order] of rows) {
        const existingOrder = firstOrderByBaseUid.get(baseUid)
        if (existingOrder === undefined || order < existingOrder) {
            firstOrderByBaseUid.set(baseUid, order)
        }
    }

    const result = new Map<string, Map<string, RefInfo>>()
    for (const [, baseUid, order, pulledRef] of rows) {
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

const attributeRowsFromPulledBaseRefs = (rows: AttributeBaseRow[]): AttributeRefRow[] => {
    const prefixes = GROUPING_ATTRIBUTE_NAMES.map(attributeName => `${attributeName}::`)
    const result: AttributeRefRow[] = []

    for (const [baseUid, pulledBase] of rows) {
        for (const child of pulledChildren(pulledBase)) {
            const childText = pulledText(child)
            const prefix = prefixes.find(candidate => childText.startsWith(candidate))
            if (!prefix) continue

            const order = pulledOrder(child)
            pulledRefs(child).forEach(ref => result.push([prefix, baseUid, order, ref]))
        }
    }

    return result
}

const queryAttributeRowsByPrefix = (
    baseRefUids: string[],
    metrics?: ReferenceGroupMetrics,
): AttributeRefRow[] => measure(metrics, 'attribute refs query fallback', () =>
    qByCollectionChunks<AttributeRefRow>(
        ATTRIBUTE_GROUP_REFS_QUERY,
        baseRefUids,
        GROUPING_ATTRIBUTE_NAMES.map(attributeName => `${attributeName}::`),
    ), {
    attributes: GROUPING_ATTRIBUTE_NAMES.length,
    baseRefs: baseRefUids.length,
    attributeLookup: 'prefix',
})

const queryAttributeRows = (
    baseRefUids: string[],
    metrics?: ReferenceGroupMetrics,
): AttributeRefRow[] => {
    try {
        const baseRows = measure(metrics, 'attribute base refs pull query', () =>
            qByCollectionChunks<AttributeBaseRow>(ATTRIBUTE_BASE_PULL_QUERY, baseRefUids), {
            baseRefs: baseRefUids.length,
            attributeLookup: 'base pull',
        })
        const rows = measure(metrics, 'attribute rows from pulled refs', () =>
            attributeRowsFromPulledBaseRefs(baseRows), {
            baseRefs: baseRows.length,
            attributes: GROUPING_ATTRIBUTE_NAMES.length,
        })
        metrics?.mark('attribute pulled refs result', {
            baseRefs: baseRows.length,
            rows: rows.length,
        })
        return rows
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        metrics?.mark('attribute base refs pull failed', {message})
        console.warn('[roam-date reference groups] attribute base pull failed; falling back to prefix query', error)
        return queryAttributeRowsByPrefix(baseRefUids, metrics)
    }
}

const attributeRowsByName = (rows: AttributeRefRow[]): Map<string, AttributeRefRow[]> => {
    const result = new Map<string, AttributeRefRow[]>()

    for (const row of rows) {
        const attributeName = row[0].slice(0, -2)
        const rowsForAttribute = result.get(attributeName) ?? []
        rowsForAttribute.push(row)
        result.set(attributeName, rowsForAttribute)
    }

    return result
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

    const rowsByAttribute = attributeRowsByName(queryAttributeRows(baseRefUids, metrics))

    for (const attributeName of GROUPING_ATTRIBUTE_NAMES) {
        const rows = rowsByAttribute.get(attributeName) ?? []
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
    backlinkPageByUid,
    baseGroupRows,
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

    const addBaseRefForMember = (memberUid: string, ref: RefInfo) => {
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

    measure(metrics, 'build base reference groups', () => {
        let skippedPulledRefs = 0
        let cachedPageRefs = 0

        const rows = baseGroupRows ?? queryBaseGroupRows(
            [...memberByUid.keys()],
            metrics,
            backlinkPageByUid === undefined,
        )
        for (const [memberUid, pulledRef] of rows) {
            const ref = toRefInfo(pulledRef)
            if (!ref) {
                skippedPulledRefs += 1
                continue
            }

            addBaseRefForMember(memberUid, ref)
        }

        if (backlinkPageByUid) {
            for (const [memberUid, page] of backlinkPageByUid) {
                if (!memberByUid.has(memberUid)) continue

                cachedPageRefs += 1
                addBaseRefForMember(memberUid, page)
            }
        }

        metrics?.mark('base reference groups built', {
            groups: referenceGroups.size,
            membersWithBaseRefs: baseRefsByMemberUid.size,
            cachedPageRefs,
            baseRowsSource: baseGroupRows ? 'prefetch' : 'query',
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
