import {useEffect, useRef} from 'react'
import {createHTMLObserver} from 'roamjs-components/dom'
import {nowMs, recordReferenceBlockRender} from '../linked-reference-groups/metrics'

interface BlockProps {
    uid: string
    showZoomPath?: boolean
    open?: boolean
    metricsContext?: 'reference-group'
}

export const Block = (props: BlockProps) => {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!ref.current) return

        /**
         * A hack to expand the zoom path of the block as by default it is squished if it's too long,
         * but I basically never want that.
         * Disconnects after we do initial unfolding, so later manual squishing is still possible.
         */
        const observer = createHTMLObserver({
            tag: 'DIV',
            className: 'squish',
            callback: (b) => {
                b.click()
                observer?.disconnect()
            },
        })

        const renderStartedAt = nowMs()
        window.roamAlphaAPI.ui.components.renderBlock({
            el: ref.current,
            uid: props.uid,
            // @ts-ignore todo on types
            'zoom-path?': props.showZoomPath,
            'open?': props.open,
        })
        if (props.metricsContext === 'reference-group') {
            recordReferenceBlockRender(props.uid, nowMs() - renderStartedAt)
        }

        return () => observer.disconnect()
    }, [ref])

    return <div className={'grouped-roam-block'} ref={ref}/>
}

Block.defaultProps = {
    showZoomPath: true,
    open: true,
}
