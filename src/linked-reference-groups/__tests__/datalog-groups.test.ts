jest.mock('roam-api-wrappers/dist/date', () => ({
    RoamDate: {
        onlyPageTitleRegex: /^January \d{1,2}(?:st|nd|rd|th), \d{4}$/,
    },
}))

jest.mock('roam-api-wrappers/dist/data/collection', () => {
    const combineRegexes = (regexes: RegExp[]) =>
        regexes.length ? new RegExp(regexes.map(r => `(?:${r.source})`).join('|')) : null

    class CommonReferencesGrouper {
        constructor(
            private fallbackGroup: string,
            private dontGroupReferencesTo: RegExp[],
            private groupPriorities: Record<'high' | 'low', RegExp[]>,
        ) {}

        deduplicateAndSortGroups(
            referenceGroups: Map<string, {text: string; members: Map<string, unknown>}>,
        ) {
            const result: [string, unknown[]][] = []
            const highMatcher = combineRegexes(this.groupPriorities.high)
            const lowMatcher = combineRegexes(this.groupPriorities.low)

            const consume = (matches: (text: string) => boolean, minGroupSize = 1) => {
                while (referenceGroups.size) {
                    const candidates = [...referenceGroups.entries()]
                        .filter(([, group]) => matches(group.text))
                        .filter(([, group]) => group.members.size >= minGroupSize)
                    if (!candidates.length) return

                    const [uid, group] = candidates
                        .reduce((a, b) => a[1].members.size > b[1].members.size ? a : b)
                    result.push([uid, [...group.members.values()]])
                    referenceGroups.delete(uid)

                    for (const consumedUid of group.members.keys()) {
                        for (const [, remainingGroup] of referenceGroups) {
                            remainingGroup.members.delete(consumedUid)
                        }
                    }
                }
            }

            consume(text => Boolean(highMatcher?.test(text)))
            consume(text => !highMatcher?.test(text) && !lowMatcher?.test(text), 2)
            consume(text => Boolean(lowMatcher?.test(text)))
            consume(() => true)

            return new Map(result)
        }
    }

    const mergeGroupsSmallerThan = (
        referenceGroups: Map<string, unknown[]>,
        intoKey: string,
        minGroupSize: number,
        dontMerge: (uid: string) => boolean,
    ) => {
        const large: [string, unknown[]][] = []
        const mergedItems: unknown[] = []

        for (const [uid, group] of referenceGroups) {
            if (!dontMerge(uid) && (group.length < minGroupSize || uid === intoKey)) {
                mergedItems.push(...group)
            } else {
                large.push([uid, group])
            }
        }

        return new Map([...large, [intoKey, mergedItems]])
    }

    return {
        CommonReferencesGrouper,
        combineRegexes,
        mergeGroupsSmallerThan,
    }
})

import {
    buildReferenceGroupsWithDatalog,
    getFilteredBacklinkUids,
    getFilteredBacklinksWithBaseRefs,
} from '../datalog-groups'

describe('getFilteredBacklinkUids', () => {
    const mockQ = jest.fn()

    beforeEach(() => {
        mockQ.mockReset()
        ;(globalThis as Record<string, unknown>).window = {
            roamAlphaAPI: {q: mockQ},
        }
    })

    afterEach(() => {
        delete (globalThis as Record<string, unknown>).window
    })

    it('intersects include filters and subtracts remove filters using Datalog result sets', () => {
        mockQ
            .mockReturnValueOnce([
                ['a', {':block/uid': 'page-a', ':node/title': 'Page A'}],
                ['b', {':block/uid': 'page-b', ':node/title': 'Drop'}],
                ['c', {':block/uid': 'page-c', ':node/title': 'Page C'}],
            ])
            .mockReturnValueOnce([['Keep', 'a']])
            .mockReturnValueOnce([['Keep', 'b']])

        const result = getFilteredBacklinkUids('root', {
            includes: ['Keep'],
            removes: ['Drop'],
        })

        expect(result).toEqual(['a'])
        expect(mockQ).toHaveBeenCalledTimes(3)
    })

    it('reuses prefetched base refs to apply filters without extra filter queries', () => {
        const keepRef = {':block/uid': 'keep', ':node/title': 'Keep'}
        mockQ
            .mockReturnValueOnce([[3]])
            .mockReturnValueOnce([
                ['a', 'page-a', 'Page A', keepRef],
                ['b', 'page-b', 'Drop', keepRef],
                ['c', 'page-c', 'Page C', {':block/uid': 'todo', ':node/title': 'TODO'}],
            ])

        const result = getFilteredBacklinksWithBaseRefs('root', {
            includes: ['Keep'],
            removes: ['Drop'],
        })

        expect(result.backlinkUids).toEqual(['a'])
        expect([...result.backlinkPageByUid.keys()]).toEqual(['a'])
        expect(result.baseGroupRows).toEqual([['a', keepRef]])
        expect(mockQ).toHaveBeenCalledTimes(2)
    })
})

describe('buildReferenceGroupsWithDatalog', () => {
    const mockQ = jest.fn()

    beforeEach(() => {
        mockQ.mockReset()
        ;(globalThis as Record<string, unknown>).window = {
            roamAlphaAPI: {q: mockQ},
        }
    })

    afterEach(() => {
        delete (globalThis as Record<string, unknown>).window
    })

    it('groups bulk Datalog rows with exclusions, attribute groups, fallback, and final merge', () => {
        mockQ.mockImplementation((query: string, values: string[], prefixes?: string[]) => {
            if (query.includes('(or-join [?block ?ref]')) {
                return [
                    ['a', null],
                    ['a', {':block/uid': 'topic', ':node/title': 'Topic'}],
                    ['b', {':block/uid': 'topic', ':node/title': 'Topic'}],
                    ['c', {':block/uid': 'todo', ':node/title': 'TODO'}],
                ]
            }

            if (query.includes(':in $ [?blockUid ...]') && query.includes('[?block :block/parents ?parent]')) {
                return []
            }

            if (query.includes(':in $ [?blockUid ...]') && query.includes('[?block :block/page ?page]')) {
                throw new Error('Expected page refs to come from the cached backlink pages')
            }

            if (query.includes(':in $ [?baseUid ...]') && query.includes('(pull ?base')) {
                expect(values).toEqual(['topic', 'page-a', 'page-b', 'page-c'])
                return [
                    ['topic', {
                        ':block/uid': 'topic',
                        ':node/title': 'Topic',
                        ':block/children': [
                            {
                                ':block/uid': 'attr',
                                ':block/order': 0,
                                ':block/string': 'isa::[[Project]]',
                                ':block/refs': [
                                    null,
                                    {':block/uid': 'project', ':node/title': 'Project'},
                                ],
                            },
                        ],
                    }],
                    ['page-a', {':block/uid': 'page-a', ':node/title': 'Page A'}],
                    ['page-b', {':block/uid': 'page-b', ':node/title': 'Page B'}],
                    ['page-c', {':block/uid': 'page-c', ':node/title': 'Page C'}],
                ]
            }

            throw new Error(`Unexpected query: ${query}`)
        })

        const result = buildReferenceGroupsWithDatalog({
            rootUid: 'root',
            rootText: 'Root',
            backlinkUids: ['a', 'b', 'c'],
            backlinkPageByUid: new Map([
                ['a', {uid: 'page-a', text: 'Page A', isPage: true}],
                ['b', {uid: 'page-b', text: 'Page B', isPage: true}],
                ['c', {uid: 'page-c', text: 'Page C', isPage: true}],
            ]),
            dontGroupReferencesTo: [/^TODO$/],
            highPriorityPages: [/^Project$/],
            lowPriorityPages: [],
            smallestGroupSize: 2,
        })

        expect(result).toEqual([
            {
                uid: 'project',
                title: 'Project',
                entities: [{uid: 'a'}, {uid: 'b'}],
            },
            {
                uid: 'root',
                title: 'Root',
                entities: [{uid: 'c'}],
            },
        ])
    })
})
