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
            .mockReturnValueOnce([['a'], ['b'], ['c']])
            .mockReturnValueOnce([['Keep', 'a']])
            .mockReturnValueOnce([['Keep', 'b']])
            .mockReturnValueOnce([['Drop', 'b']])

        const result = getFilteredBacklinkUids('root', {
            includes: ['Keep'],
            removes: ['Drop'],
        })

        expect(result).toEqual(['a'])
        expect(mockQ).toHaveBeenCalledTimes(4)
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
            if (query.includes(':in $ [?blockUid ...]') && query.includes('[?block :block/refs ?ref]')) {
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
                return []
            }

            if (query.includes(':in $ [?baseUid ...]') && prefixes?.includes('isa::')) {
                expect(values).toEqual(['topic'])
                expect(prefixes).toEqual(['isa::', 'group with::'])
                return [
                    ['isa::', 'topic', 0, null],
                    ['isa::', 'topic', 0, {':block/uid': 'project', ':node/title': 'Project'}],
                ]
            }

            throw new Error(`Unexpected query: ${query}`)
        })

        const result = buildReferenceGroupsWithDatalog({
            rootUid: 'root',
            rootText: 'Root',
            backlinkUids: ['a', 'b', 'c'],
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
