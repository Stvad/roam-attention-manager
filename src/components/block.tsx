import {useEffect, useRef} from 'react'

interface BlockProps {
    uid: string
    showZoomPath?: boolean
}

export const Block = (props: BlockProps) => {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!ref.current) return

        window.roamAlphaAPI.ui.components.renderBlock({
            el: ref.current,
            uid: props.uid,
            // @ts-ignore todo on types
            "zoom-path?": props.showZoomPath,
        })
    }, [ref])

    return <div className={'grouped-roam-block'} ref={ref}/>
}

Block.defaultProps = {
    showZoomPath: true,
}
