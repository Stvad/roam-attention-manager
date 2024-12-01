import {useEffect, useRef} from 'react'
import {createHTMLObserver} from 'roamjs-components/dom'

interface BlockProps {
    uid: string
    showZoomPath?: boolean
    open?: boolean
}

export const Block = (props: BlockProps) => {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!ref.current) return

        /**
         * A hack to expand the zoom path of the block as by default it is squished if it's too long,
         * but I basically never want that
         */
        const observer = createHTMLObserver({
            tag: 'DIV',
            className: 'squish',
            callback: (b) => b.click(),
        })

        window.roamAlphaAPI.ui.components.renderBlock({
            el: ref.current,
            uid: props.uid,
            // @ts-ignore todo on types
            'zoom-path?': props.showZoomPath,
            'open?': props.open,
        })

        return () => observer.disconnect()
    }, [ref])

    return <div className={'grouped-roam-block'} ref={ref}/>
}

Block.defaultProps = {
    showZoomPath: true,
    open: true,
}
