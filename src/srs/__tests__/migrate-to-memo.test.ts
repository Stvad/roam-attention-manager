const MONTHS = '(?:January|February|March|April|May|June|July|August|September|October|November|December)'
const DAY = '\\d{1,2}(?:st|nd|rd|th)'
const YEAR = '\\d{4}'
const DATE_PATTERN = `${MONTHS} ${DAY}, ${YEAR}`

jest.mock('roam-api-wrappers/dist/date', () => ({
    RoamDate: {
        regex: new RegExp(DATE_PATTERN),
        referenceRegex: new RegExp(`\\[\\[${DATE_PATTERN}\\]\\]`, 'g'),
        parseFromReference: (ref: string) => {
            const inner = ref.replace(/\[\[|\]\]/g, '')
            const cleaned = inner.replace(/(\d+)(?:st|nd|rd|th)/, '$1')
            return new Date(cleaned)
        },
        toRoam: (d: Date) => {
            const months = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December']
            const day = d.getDate()
            const suffix = [, 'st', 'nd', 'rd'][day % 10 > 3 ? 0 : (day % 100 - day % 10 !== 10 ? day % 10 : 0)] || 'th'
            return `${months[d.getMonth()]} ${day}${suffix}, ${d.getFullYear()}`
        },
        toDatePage: (d: Date) => `[[${d.toDateString()}]]`,
    },
}))

const mockFromUid = jest.fn()
jest.mock('roam-api-wrappers/dist/data', () => ({
    Block: { fromUid: (...args: unknown[]) => mockFromUid(...args) },
    Roam: {},
}))

jest.mock('@blueprintjs/core', () => ({
    Toaster: { create: () => ({ show: jest.fn() }) },
    Intent: { SUCCESS: 'success', WARNING: 'warning', DANGER: 'danger' },
    Position: { TOP: 'top' },
}))

import {
    parseMetadataFromText,
    estimateRepetitions,
    stripRoamToolkitMetadata,
    gradeToEmoji,
    findMigrationSource,
    MIGRATION_EVENT,
    MIGRATION_RESULT_EVENT,
} from '../migrate-to-memo'

describe('parseMetadataFromText', () => {
    it('parses full metadata with interval, factor, date, and stars', () => {
        const text = '[[[[interval]]:42.5]] [[[[factor]]:2.35]] [[February 28th, 2026]] * * * *'
        const result = parseMetadataFromText(text)

        expect(result).not.toBeNull()
        expect(result!.interval).toBe(42.5)
        expect(result!.factor).toBe(2.35)
        expect(result!.nextDueDate).toBeInstanceOf(Date)
        expect(result!.nextDueDate!.getFullYear()).toBe(2026)
        expect(result!.nextDueDate!.getMonth()).toBe(1) // February = 1
        expect(result!.starCount).toBe(4)
    })

    it('parses metadata with only interval', () => {
        const text = 'Some block text [[[[interval]]:10.0]]'
        const result = parseMetadataFromText(text)

        expect(result).not.toBeNull()
        expect(result!.interval).toBe(10.0)
        expect(result!.factor).toBe(2.5) // default
        expect(result!.nextDueDate).toBeUndefined()
        expect(result!.starCount).toBe(0)
    })

    it('parses metadata with only factor', () => {
        const text = 'Review this [[[[factor]]:1.80]]'
        const result = parseMetadataFromText(text)

        expect(result).not.toBeNull()
        expect(result!.interval).toBe(1) // default
        expect(result!.factor).toBe(1.8)
    })

    it('returns null for text without metadata', () => {
        expect(parseMetadataFromText('Just a regular block')).toBeNull()
        expect(parseMetadataFromText('')).toBeNull()
        expect(parseMetadataFromText('[[some page]]')).toBeNull()
    })

    it('parses metadata with double colon format', () => {
        const text = '[[[[interval]]::15.0]] [[[[factor]]::2.50]]'
        const result = parseMetadataFromText(text)

        expect(result).not.toBeNull()
        expect(result!.interval).toBe(15.0)
        expect(result!.factor).toBe(2.5)
    })

    it('preserves zero interval instead of defaulting to 1', () => {
        const text = '[[[[interval]]:0]]'
        const result = parseMetadataFromText(text)

        expect(result).not.toBeNull()
        expect(result!.interval).toBe(0)
    })

    it('counts stars correctly with varying whitespace', () => {
        const text = '[[[[interval]]:5]] * * *'
        const result = parseMetadataFromText(text)

        expect(result).not.toBeNull()
        expect(result!.starCount).toBe(3)
    })

    it('picks last date when multiple dates present', () => {
        const text = '[[[[interval]]:5]] [[January 1st, 2025]] [[March 15th, 2026]]'
        const result = parseMetadataFromText(text)

        expect(result).not.toBeNull()
        expect(result!.nextDueDate!.getFullYear()).toBe(2026)
        expect(result!.nextDueDate!.getMonth()).toBe(2) // March = 2
    })
})

describe('estimateRepetitions', () => {
    it('uses star count directly when > 0', () => {
        expect(estimateRepetitions(42, 5)).toBe(5)
        expect(estimateRepetitions(1, 3)).toBe(3)
        expect(estimateRepetitions(100, 1)).toBe(1)
    })

    it('returns 0 for interval <= 1 with no stars', () => {
        expect(estimateRepetitions(0, 0)).toBe(0)
        expect(estimateRepetitions(0.5, 0)).toBe(0)
        expect(estimateRepetitions(1, 0)).toBe(0)
    })

    it('returns 1 for interval <= 6 with no stars', () => {
        expect(estimateRepetitions(2, 0)).toBe(1)
        expect(estimateRepetitions(5, 0)).toBe(1)
        expect(estimateRepetitions(6, 0)).toBe(1)
    })

    it('returns 2 for interval > 6 with no stars', () => {
        expect(estimateRepetitions(7, 0)).toBe(2)
        expect(estimateRepetitions(42, 0)).toBe(2)
        expect(estimateRepetitions(365, 0)).toBe(2)
    })
})

describe('gradeToEmoji', () => {
    it('maps grade 5 to green circle', () => {
        expect(gradeToEmoji(5)).toBe('🟢')
    })

    it('maps grade 4 to blue circle', () => {
        expect(gradeToEmoji(4)).toBe('🔵')
    })

    it('maps grade 3 to orange circle', () => {
        expect(gradeToEmoji(3)).toBe('🟠')
    })

    it('maps grade 0 to red circle', () => {
        expect(gradeToEmoji(0)).toBe('🔴')
    })

    it('defaults to blue circle for unknown grades', () => {
        expect(gradeToEmoji(1)).toBe('🔵')
        expect(gradeToEmoji(2)).toBe('🔵')
        expect(gradeToEmoji(99)).toBe('🔵')
    })
})

describe('stripRoamToolkitMetadata', () => {
    it('strips interval property', () => {
        const result = stripRoamToolkitMetadata('Some text [[[[interval]]:42.5]]')
        expect(result).toBe('Some text')
    })

    it('strips factor property', () => {
        const result = stripRoamToolkitMetadata('Some text [[[[factor]]:2.35]]')
        expect(result).toBe('Some text')
    })

    it('strips date references', () => {
        const result = stripRoamToolkitMetadata('Some text [[February 28th, 2026]]')
        expect(result).toBe('Some text')
    })

    it('strips trailing stars', () => {
        const result = stripRoamToolkitMetadata('Some text * * * *')
        expect(result).toBe('Some text')
    })

    it('strips all metadata at once', () => {
        const text = '[[[[interval]]:42.5]] [[[[factor]]:2.35]] [[February 28th, 2026]] * * * *'
        const result = stripRoamToolkitMetadata(text)
        expect(result).toBe('')
    })

    it('preserves non-metadata text', () => {
        const text = 'Review this important block [[[[interval]]:10]] [[[[factor]]:2.0]] [[January 5th, 2025]] *'
        const result = stripRoamToolkitMetadata(text)
        expect(result).toBe('Review this important block')
    })

    it('handles text with only metadata', () => {
        const text = '[[[[interval]]:1.0]]'
        const result = stripRoamToolkitMetadata(text)
        expect(result).toBe('')
    })

    it('returns empty for metadata-only block with all fields', () => {
        const text = ' [[[[interval]]:13.1]] [[[[factor]]:1.30]] [[March 1st, 2026]] * * * * * * * * * * * * * * * * '
        const result = stripRoamToolkitMetadata(text)
        expect(result).toBe('')
    })

    it('preserves content when block has both text and metadata', () => {
        const text = 'statins - plausible should start taking them- research[[[[interval]]:2.4]] [[[[factor]]:2.5]]  [[March 1st, 2026]]'
        const result = stripRoamToolkitMetadata(text)
        expect(result).toBe('statins - plausible should start taking them- research')
    })

    it('handles double colon format', () => {
        const text = 'Block text [[[[interval]]::15.0]] [[[[factor]]::2.50]]'
        const result = stripRoamToolkitMetadata(text)
        expect(result).toBe('Block text')
    })

    it('collapses multiple spaces into one', () => {
        const text = 'Hello  [[[[interval]]:5]]  world'
        const result = stripRoamToolkitMetadata(text)
        expect(result).toBe('Hello world')
    })
})

describe('metadata-only block detection', () => {
    it('detects metadata-only block (stripped text is empty)', () => {
        const metadataOnly = ' [[[[interval]]:13.1]] [[[[factor]]:1.30]] [[March 1st, 2026]] * * * * '
        const stripped = stripRoamToolkitMetadata(metadataOnly)
        expect(stripped).toBe('')
        expect(parseMetadataFromText(metadataOnly)).not.toBeNull()
    })

    it('detects block with real content (stripped text is non-empty)', () => {
        const withContent = 'Review this [[[[interval]]:2.4]] [[[[factor]]:2.5]] [[March 1st, 2026]]'
        const stripped = stripRoamToolkitMetadata(withContent)
        expect(stripped).not.toBe('')
        expect(parseMetadataFromText(withContent)).not.toBeNull()
    })
})

describe('interval preservation', () => {
    it('parseMetadataFromText preserves decimal intervals', () => {
        const text = '[[[[interval]]:2.4]] [[[[factor]]:2.5]]'
        const result = parseMetadataFromText(text)
        expect(result!.interval).toBe(2.4)
    })

    it('parseMetadataFromText preserves decimal intervals like 13.1', () => {
        const text = '[[[[interval]]:13.1]] [[[[factor]]:1.30]]'
        const result = parseMetadataFromText(text)
        expect(result!.interval).toBe(13.1)
        expect(result!.factor).toBe(1.3)
    })
})

describe('findMigrationSource', () => {
    const mockQ = jest.fn()

    beforeEach(() => {
        mockFromUid.mockReset()
        mockQ.mockReset()
        ;(globalThis as Record<string, unknown>).window = {
            roamAlphaAPI: { q: mockQ },
        }
    })

    afterEach(() => {
        delete (globalThis as Record<string, unknown>).window
    })

    it('returns inline source when block has metadata and non-empty stripped text', () => {
        mockFromUid.mockReturnValue({
            text: 'Review this [[[[interval]]:5]] [[[[factor]]:2.5]]',
        })

        const result = findMigrationSource('block1')

        expect(result).not.toBeNull()
        expect(result!.reviewBlockUid).toBe('block1')
        expect(result!.metadataBlockUid).toBe('block1')
        expect(result!.metadataIsInline).toBe(true)
        expect(result!.metadata.interval).toBe(5)
    })

    it('uses parent as review block when block is metadata-only', () => {
        mockFromUid.mockReturnValue({
            text: '[[[[interval]]:13.1]] [[[[factor]]:1.30]] [[March 1st, 2026]] * * *',
        })
        // getParentUid query returns parent uid
        mockQ.mockReturnValue([['parent-uid-123']])

        const result = findMigrationSource('metadata-block')

        expect(result).not.toBeNull()
        expect(result!.reviewBlockUid).toBe('parent-uid-123')
        expect(result!.metadataBlockUid).toBe('metadata-block')
        expect(result!.metadataIsInline).toBe(false)
    })

    it('returns null for metadata-only block with no parent', () => {
        mockFromUid.mockReturnValue({
            text: '[[[[interval]]:5]] [[[[factor]]:2.5]]',
        })
        // getParentUid query returns no results
        mockQ.mockReturnValue([])

        const result = findMigrationSource('orphan-block')

        expect(result).toBeNull()
    })

    it('finds metadata in child blocks when parent has none', () => {
        mockFromUid.mockReturnValue({ text: 'Parent block with no metadata' })
        // getChildBlocks query returns a child with metadata
        mockQ.mockReturnValue([
            [{ uid: 'child1', string: '[[[[interval]]:10]] [[[[factor]]:2.0]]', order: 0 }],
        ])

        const result = findMigrationSource('parent-block')

        expect(result).not.toBeNull()
        expect(result!.reviewBlockUid).toBe('parent-block')
        expect(result!.metadataBlockUid).toBe('child1')
        expect(result!.metadataIsInline).toBe(false)
    })

    it('returns null when block has no metadata and no children with metadata', () => {
        mockFromUid.mockReturnValue({ text: 'Just a plain block' })
        // getChildBlocks query returns children without metadata
        mockQ.mockReturnValue([
            [{ uid: 'child1', string: 'No metadata here', order: 0 }],
        ])

        const result = findMigrationSource('plain-block')

        expect(result).toBeNull()
    })

    it('returns null when block does not exist', () => {
        mockFromUid.mockReturnValue(null)

        const result = findMigrationSource('nonexistent')

        expect(result).toBeNull()
    })
})

describe('event constants', () => {
    it('exports correct event names', () => {
        expect(MIGRATION_EVENT).toBe('roam-date:migrate-to-memo')
        expect(MIGRATION_RESULT_EVENT).toBe('roam-date:migrate-to-memo:done')
    })
})
