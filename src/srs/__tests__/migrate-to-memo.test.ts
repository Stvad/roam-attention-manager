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

jest.mock('roam-api-wrappers/dist/data', () => ({
    Block: { fromUid: jest.fn() },
    Roam: {},
}))

import {
    parseMetadataFromText,
    estimateRepetitions,
    stripRoamToolkitMetadata,
    gradeToEmoji,
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

    it('handles zero interval by defaulting to 1', () => {
        const text = '[[[[interval]]:0]]'
        const result = parseMetadataFromText(text)

        expect(result).not.toBeNull()
        // parseFloat('0') is 0 which is falsy, so || 1 kicks in
        expect(result!.interval).toBe(1)
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

describe('event constants', () => {
    it('exports correct event names', () => {
        expect(MIGRATION_EVENT).toBe('roam-date:migrate-to-memo')
        expect(MIGRATION_RESULT_EVENT).toBe('roam-date:migrate-to-memo:done')
    })
})
