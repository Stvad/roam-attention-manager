import {Block} from 'roam-api-wrappers/dist/data'
import {RoamDate} from 'roam-api-wrappers/dist/date'
import {Toaster, Intent, Position} from '@blueprintjs/core'
import {RoamNode} from './SM2Node'

const MEMO_DATA_PAGE = 'roam/memo'
const ARCHIVE_PAGE = 'roam-toolkit-srs/archive'
const SRM_TAG = 'srm'

const toaster = Toaster.create({position: Position.TOP})

export type MigrationResult = 'success' | 'not-found' | 'already-exists' | 'error'

type IntentType = typeof Intent[keyof typeof Intent]

export function showMigrationToast(message: string, intent: IntentType = Intent.SUCCESS) {
    toaster.show({message, intent})
}

export const MIGRATION_EVENT = 'roam-date:migrate-to-memo'
export const MIGRATION_RESULT_EVENT = 'roam-date:migrate-to-memo:done'

// --- Types ---

export interface ParsedMetadata {
    interval: number
    factor: number
    nextDueDate: Date | undefined
    starCount: number
}

export interface MigrationPreview {
    found: boolean
    alreadyMigrated: boolean
    reviewBlockUid: string
    metadataBlockUid: string
    metadataIsInline: boolean
    metadata: ParsedMetadata | null
    memoData: {
        grade: number
        eFactor: number
        interval: number
        repetitions: number
        nextDueDate: Date
        reviewMode: string
    } | null
    strippedText: string | null
}

interface MigrationSource {
    reviewBlockUid: string
    metadata: ParsedMetadata
    metadataBlockUid: string
    metadataIsInline: boolean
}

interface ChildBlockResult {
    uid: string
    string: string
    order: number
}

interface MigrationEventDetail {
    blockUid: string
    dryRun?: boolean
}

// --- Pure functions (exported for testing) ---

function parseFloatOrDefault(str: string, defaultValue: number): number {
    const parsed = parseFloat(str)
    return isNaN(parsed) ? defaultValue : parsed
}

export function parseMetadataFromText(text: string): ParsedMetadata | null {
    const node = new RoamNode(text)
    const intervalStr = node.getInlineProperty('interval')
    const factorStr = node.getInlineProperty('factor')

    if (!intervalStr && !factorStr) return null

    const dateRefs = text.match(RoamDate.referenceRegex)
    const nextDueDate = dateRefs?.length
        ? RoamDate.parseFromReference(dateRefs[dateRefs.length - 1])
        : undefined

    const starCount = (text.match(/\*/g) || []).length

    return {
        interval: intervalStr ? parseFloatOrDefault(intervalStr, 1) : 1,
        factor: factorStr ? parseFloatOrDefault(factorStr, 2.5) : 2.5,
        nextDueDate,
        starCount,
    }
}

export function estimateRepetitions(interval: number, starCount: number): number {
    if (starCount > 0) return starCount
    if (interval <= 1) return 0
    if (interval <= 6) return 1
    return 2
}

export function gradeToEmoji(grade: number): string {
    switch (grade) {
        case 5: return '🟢'
        case 4: return '🔵'
        case 3: return '🟠'
        case 0: return '🔴'
        default: return '🔵'
    }
}

export function stripRoamToolkitMetadata(text: string): string {
    let result = text
    result = result.replace(RoamNode.getInlinePropertyMatcher('interval'), '')
    result = result.replace(RoamNode.getInlinePropertyMatcher('factor'), '')
    result = result.replace(RoamDate.referenceRegex, '')
    result = result.replace(/(\s*\*)+\s*$/, '')
    result = result.replace(/\s{2,}/g, ' ').trim()
    return result
}

// --- Roam API helpers (internal) ---

function getParentUid(blockUid: string): string | null {
    const results = window.roamAlphaAPI.q(`
        [:find ?parent-uid :in $ ?uid :where
         [?block :block/uid ?uid]
         [?parent :block/children ?block]
         [?parent :block/uid ?parent-uid]]`, blockUid) as string[][]
    return results?.length ? results[0][0] : null
}

function getChildBlocks(parentUid: string): ChildBlockResult[] {
    const results = window.roamAlphaAPI.q(`
        [:find (pull ?child [:block/uid :block/string :block/order])
         :in $ ?parentUid
         :where
           [?parent :block/uid ?parentUid]
           [?parent :block/children ?child]]`, parentUid) as [ChildBlockResult][]
    return (results || [])
        .map(r => r[0])
        .sort((a, b) => a.order - b.order)
}

export function findMigrationSource(blockUid: string): MigrationSource | null {
    const block = Block.fromUid(blockUid)
    if (!block) return null

    const inlineMetadata = parseMetadataFromText(block.text)
    if (inlineMetadata) {
        const stripped = stripRoamToolkitMetadata(block.text)
        if (!stripped) {
            // Block is metadata-only — use parent as the review block
            const parentUid = getParentUid(blockUid)
            if (parentUid) {
                return {
                    reviewBlockUid: parentUid,
                    metadata: inlineMetadata,
                    metadataBlockUid: blockUid,
                    metadataIsInline: false,
                }
            }
            // No parent found — this is a top-level metadata-only block, skip migration
            console.warn(`Metadata-only block ${blockUid} has no parent block — skipping migration`)
            return null
        }
        return {
            reviewBlockUid: blockUid,
            metadata: inlineMetadata,
            metadataBlockUid: blockUid,
            metadataIsInline: true,
        }
    }

    const children = getChildBlocks(blockUid)
    for (const child of children) {
        const childMetadata = parseMetadataFromText(child.string)
        if (childMetadata) {
            return {
                reviewBlockUid: blockUid,
                metadata: childMetadata,
                metadataBlockUid: child.uid,
                metadataIsInline: false,
            }
        }
    }

    return null
}

function getPageUid(title: string): string | null {
    const results = window.roamAlphaAPI.q(
        `[:find ?uid :in $ ?title :where [?page :node/title ?title] [?page :block/uid ?uid]]`,
        title
    ) as string[][]
    return results?.length ? results[0][0] : null
}

async function getOrCreatePageUid(title: string): Promise<string> {
    const existing = getPageUid(title)
    if (existing) return existing
    const uid = window.roamAlphaAPI.util.generateUID()
    await window.roamAlphaAPI.data.page.create({page: {title, uid}})
    return uid
}

function getBlockOnPage(pageTitle: string, blockString: string): string | null {
    const results = window.roamAlphaAPI.q(`
        [:find ?block_uid :in $ ?page_title ?block_string :where
         [?page :node/title ?page_title]
         [?block :block/parents ?page]
         [?block :block/string ?block_string]
         [?block :block/uid ?block_uid]]`, pageTitle, blockString) as string[][]
    return results?.length ? results[0][0] : null
}

function getChildBlockByPrefix(parentUid: string, prefix: string): string | null {
    const results = window.roamAlphaAPI.q(`
        [:find ?block_uid :in $ ?parent_uid ?prefix
         :where
           [?parent :block/uid ?parent_uid]
           [?block :block/parents ?parent]
           [?block :block/string ?block_string]
           [(clojure.string/starts-with? ?block_string ?prefix)]
           [?block :block/uid ?block_uid]]`, parentUid, prefix) as string[][]
    return results?.length ? results[0][0] : null
}

async function createChildBlock(parentUid: string, text: string, order: number, props: Record<string, unknown> = {}): Promise<string> {
    const uid = window.roamAlphaAPI.util.generateUID()
    await window.roamAlphaAPI.createBlock({
        location: {'parent-uid': parentUid, order},
        block: {string: text, uid, ...props},
    })
    return uid
}

async function getOrCreateBlockOnPage(pageTitle: string, blockString: string, order: number, props: Record<string, unknown> = {}): Promise<string> {
    const existing = getBlockOnPage(pageTitle, blockString)
    if (existing) return existing
    const pageUid = await getOrCreatePageUid(pageTitle)
    return createChildBlock(pageUid, blockString, order, props)
}

// --- Dry-run preview ---

export function previewMigration(blockUid: string): MigrationPreview {
    const source = findMigrationSource(blockUid)
    if (!source) {
        return {
            found: false,
            alreadyMigrated: false,
            reviewBlockUid: blockUid,
            metadataBlockUid: '',
            metadataIsInline: false,
            metadata: null,
            memoData: null,
            strippedText: null,
        }
    }

    const {reviewBlockUid, metadata, metadataBlockUid, metadataIsInline} = source
    const {interval, factor, nextDueDate, starCount} = metadata

    const dataBlockUid = getBlockOnPage(MEMO_DATA_PAGE, 'data')
    const alreadyMigrated = dataBlockUid
        ? !!getChildBlockByPrefix(dataBlockUid, `((${reviewBlockUid}))`)
        : false

    // Default to Good (4) since roam-toolkit doesn't store per-review grades
    const grade = 4
    const repetitions = estimateRepetitions(interval, starCount)
    const effectiveNextDueDate = nextDueDate || new Date(Date.now() + interval * 24 * 60 * 60 * 1000)

    const originalText = metadataIsInline
        ? Block.fromUid(metadataBlockUid)?.text || ''
        : ''

    return {
        found: true,
        alreadyMigrated,
        reviewBlockUid,
        metadataBlockUid,
        metadataIsInline,
        metadata,
        memoData: {
            grade,
            eFactor: factor,
            interval,
            repetitions,
            nextDueDate: effectiveNextDueDate,
            reviewMode: 'SPACED_INTERVAL',
        },
        strippedText: metadataIsInline ? stripRoamToolkitMetadata(originalText) : null,
    }
}

// --- Core migration ---

export async function migrateBlockToMemo(blockUid: string): Promise<MigrationResult> {
    try {
        const source = findMigrationSource(blockUid)
        if (!source) {
            console.log(`No roam-toolkit SRS metadata found for block ${blockUid}`)
            return 'not-found'
        }

        const {reviewBlockUid, metadata, metadataBlockUid, metadataIsInline} = source
        const {interval, factor, nextDueDate, starCount} = metadata

        // Default to Good (4) since roam-toolkit doesn't store per-review grades
        const grade = 4
        const repetitions = estimateRepetitions(interval, starCount)
        const effectiveNextDueDate = nextDueDate || new Date(Date.now() + interval * 24 * 60 * 60 * 1000)
        const emoji = gradeToEmoji(grade)
        const dateCreated = new Date()

        // 1. Create roam/memo data entry
        await getOrCreatePageUid(MEMO_DATA_PAGE)
        const dataBlockUid = await getOrCreateBlockOnPage(MEMO_DATA_PAGE, 'data', -1, {
            open: false,
            heading: 3,
        })

        const existingEntry = getChildBlockByPrefix(dataBlockUid, `((${reviewBlockUid}))`)
        if (existingEntry) {
            console.log(`roam/memo entry already exists for block ${reviewBlockUid}, skipping`)
            return 'already-exists'
        }

        const cardBlockUid = await createChildBlock(dataBlockUid, `((${reviewBlockUid}))`, 0, {open: false})
        const sessionBlockUid = await createChildBlock(
            cardBlockUid,
            `[[${RoamDate.toRoam(dateCreated)}]] ${emoji}`,
            0,
            {open: false},
        )
        await createChildBlock(sessionBlockUid, `grade:: ${grade}`, -1)
        await createChildBlock(sessionBlockUid, `eFactor:: ${factor}`, -1)
        await createChildBlock(sessionBlockUid, `interval:: ${interval}`, -1)
        await createChildBlock(sessionBlockUid, `repetitions:: ${repetitions}`, -1)
        await createChildBlock(sessionBlockUid, `nextDueDate:: [[${RoamDate.toRoam(effectiveNextDueDate)}]]`, -1)
        await createChildBlock(sessionBlockUid, `reviewMode:: SPACED_INTERVAL`, -1)

        // 2. Archive old metadata
        const originalText = Block.fromUid(metadataBlockUid)?.text || ''
        await getOrCreatePageUid(ARCHIVE_PAGE)
        const archiveEntryUid = await getOrCreateBlockOnPage(
            ARCHIVE_PAGE, `((${reviewBlockUid}))`, 0, {open: false},
        )

        if (metadataIsInline) {
            // Inline: strip metadata and add #srm in a single write to avoid race condition
            await createChildBlock(archiveEntryUid, originalText, -1)
            let stripped = stripRoamToolkitMetadata(originalText)
            if (!stripped.includes(`#${SRM_TAG}`)) {
                stripped = (stripped ? stripped + ' ' : '') + `#${SRM_TAG}`
            }
            const block = Block.fromUid(metadataBlockUid)
            if (block) block.text = stripped
        } else {
            // Child metadata block: move to archive, then tag review block (separate blocks, no race)
            await window.roamAlphaAPI.moveBlock({
                location: {'parent-uid': archiveEntryUid, order: -1},
                block: {uid: metadataBlockUid},
            })
            const reviewBlock = Block.fromUid(reviewBlockUid)
            if (reviewBlock && !reviewBlock.text.includes(`#${SRM_TAG}`)) {
                reviewBlock.text = reviewBlock.text + ` #${SRM_TAG}`
            }
        }

        console.log(`Migrated block ${reviewBlockUid} to roam/memo format`)
        return 'success'
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Migration failed for block ${blockUid}:`, error)
        return 'error'
    }
}

export async function migrateCurrentBlockToMemo() {
    const currentBlockUid = window.roamAlphaAPI.ui.getFocusedBlock()?.['block-uid']
    if (!currentBlockUid) {
        toaster.show({message: 'No block focused', intent: Intent.WARNING})
        return
    }
    const result = await migrateBlockToMemo(currentBlockUid)
    switch (result) {
        case 'success':
            toaster.show({message: 'Migrated to roam/memo', intent: Intent.SUCCESS})
            break
        case 'not-found':
            toaster.show({message: 'No roam-toolkit metadata found', intent: Intent.WARNING})
            break
        case 'already-exists':
            toaster.show({message: 'Already migrated to roam/memo', intent: Intent.WARNING})
            break
        case 'error':
            toaster.show({message: 'Migration failed — check console', intent: Intent.DANGER})
            break
    }
}

// --- Browser event listener (for cross-plugin triggering) ---
// Other plugins can trigger migration via:
//   document.dispatchEvent(new CustomEvent('roam-date:migrate-to-memo', { detail: { blockUid: 'xxx' } }))
//   document.dispatchEvent(new CustomEvent('roam-date:migrate-to-memo', { detail: { blockUid: 'xxx', dryRun: true } }))
// Results are dispatched as:
//   'roam-date:migrate-to-memo:done' with detail { blockUid, success, preview? }

function handleMigrationEvent(event: Event) {
    const detail = (event as CustomEvent<MigrationEventDetail>).detail
    if (!detail?.blockUid) return

    if (detail.dryRun) {
        const preview = previewMigration(detail.blockUid)
        document.dispatchEvent(new CustomEvent(MIGRATION_RESULT_EVENT, {
            detail: {blockUid: detail.blockUid, success: preview.found && !preview.alreadyMigrated, preview},
        }))
    } else {
        void migrateBlockToMemo(detail.blockUid).then(result => {
            document.dispatchEvent(new CustomEvent(MIGRATION_RESULT_EVENT, {
                detail: {blockUid: detail.blockUid, success: result === 'success', result},
            }))
        })
    }
}

export function setupMigrationEventListener() {
    document.addEventListener(MIGRATION_EVENT, handleMigrationEvent)
}

export function teardownMigrationEventListener() {
    document.removeEventListener(MIGRATION_EVENT, handleMigrationEvent)
}
