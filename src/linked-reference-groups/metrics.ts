type MetricDetails = Record<string, unknown>

type MetricEntry = {
    stage: string
    durationMs?: number
    details?: MetricDetails
}

type ReferenceGroupMetricsContext = {
    entityUid: string
    refresh: boolean
    smallestGroupSize: number
    highPriorityPageCount: number
    lowPriorityPageCount: number
}

export type ReferenceGroupMetrics = {
    id: string
    mark: (stage: string, details?: MetricDetails) => void
    measure: <T>(stage: string, fn: () => T, details?: MetricDetails) => T
    log: (label: string, details?: MetricDetails) => void
}

type PendingBlockRenderMetrics = {
    runId: string
    entityUid: string
    expectedBlocks: number
    groups: number
    startedAt: number
    count: number
    totalMs: number
    maxMs: number
    maxUid?: string
    timer?: ReturnType<typeof setTimeout>
}

const LOG_PREFIX = '[roam-date reference groups]'

let activeBlockRenderMetrics: PendingBlockRenderMetrics | null = null

export const nowMs = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()

const roundMs = (value: number) => Math.round(value * 10) / 10

export const createReferenceGroupMetrics = (context: ReferenceGroupMetricsContext): ReferenceGroupMetrics => {
    const startedAt = nowMs()
    const entries: MetricEntry[] = []
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

    const mark = (stage: string, details?: MetricDetails) => {
        entries.push({stage, details})
    }

    const measure = <T,>(stage: string, fn: () => T, details?: MetricDetails): T => {
        const started = nowMs()
        const result = fn()
        entries.push({
            stage,
            durationMs: roundMs(nowMs() - started),
            details,
        })
        return result
    }

    const log = (label: string, details: MetricDetails = {}) => {
        const totalMs = roundMs(nowMs() - startedAt)
        console.groupCollapsed(`${LOG_PREFIX} ${label} ${context.entityUid} ${totalMs}ms`)
        console.info({
            runId: id,
            totalMs,
            ...context,
            ...details,
        })
        console.table(entries.map(entry => ({
            stage: entry.stage,
            durationMs: entry.durationMs ?? '',
            ...(entry.details ?? {}),
        })))
        console.groupEnd()
    }

    mark('start', context)

    return {id, mark, measure, log}
}

export const logReferenceGroupsCommit = ({
    runId,
    entityUid,
    durationMs,
    groups,
    blocks,
}: {
    runId: string
    entityUid: string
    durationMs: number
    groups: number
    blocks: number
}) => {
    console.info(`${LOG_PREFIX} react commit`, {
        runId,
        entityUid,
        durationMs: roundMs(durationMs),
        groups,
        blocks,
    })
}

const finishBlockRenderMetrics = (reason: string) => {
    if (!activeBlockRenderMetrics) return

    const metrics = activeBlockRenderMetrics
    activeBlockRenderMetrics = null
    if (metrics.timer) clearTimeout(metrics.timer)

    const wallMs = roundMs(nowMs() - metrics.startedAt)
    const averageMs = metrics.count ? metrics.totalMs / metrics.count : 0

    console.info(`${LOG_PREFIX} renderBlock aggregate`, {
        runId: metrics.runId,
        entityUid: metrics.entityUid,
        reason,
        expectedBlocks: metrics.expectedBlocks,
        renderedBlocks: metrics.count,
        groups: metrics.groups,
        wallMs,
        totalRenderBlockMs: roundMs(metrics.totalMs),
        averageRenderBlockMs: roundMs(averageMs),
        maxRenderBlockMs: roundMs(metrics.maxMs),
        maxRenderBlockUid: metrics.maxUid,
    })
}

export const startReferenceBlockRenderMetrics = ({
    runId,
    entityUid,
    expectedBlocks,
    groups,
}: {
    runId: string
    entityUid: string
    expectedBlocks: number
    groups: number
}) => {
    finishBlockRenderMetrics('replaced-by-new-run')

    activeBlockRenderMetrics = {
        runId,
        entityUid,
        expectedBlocks,
        groups,
        startedAt: nowMs(),
        count: 0,
        totalMs: 0,
        maxMs: 0,
    }

    if (expectedBlocks === 0) {
        activeBlockRenderMetrics.timer = setTimeout(() => finishBlockRenderMetrics('no-blocks'), 0)
    }
}

export const recordReferenceBlockRender = (uid: string, durationMs: number) => {
    if (!activeBlockRenderMetrics) return

    activeBlockRenderMetrics.count += 1
    activeBlockRenderMetrics.totalMs += durationMs

    if (durationMs > activeBlockRenderMetrics.maxMs) {
        activeBlockRenderMetrics.maxMs = durationMs
        activeBlockRenderMetrics.maxUid = uid
    }

    if (activeBlockRenderMetrics.timer) clearTimeout(activeBlockRenderMetrics.timer)

    const done = activeBlockRenderMetrics.count >= activeBlockRenderMetrics.expectedBlocks
    activeBlockRenderMetrics.timer = setTimeout(
        () => finishBlockRenderMetrics(done ? 'expected-blocks-rendered' : 'idle-timeout'),
        done ? 0 : 1000,
    )
}
