import * as ReactDOM from 'react-dom'
import {Page, RoamEntity} from 'roam-api-wrappers/dist/data'
import {Block} from '../components/block'
import {config} from '../config'
import 'arrive'


const containerClass = 'priority-item-container'

// todo unify with other config
export const setup = async () => {
    document.arrive('.roam-article .rm-title-display', {existing: true}, async title => {
        const container = document.createElement('div')
        container.className = containerClass + ', rm-mentions'

        title?.after(container)

        void renderPriorityItemForDailyPages(container)
    })
}

export const teardown = () => {
    const container = document.querySelector(`.${containerClass}`)
    container?.parentNode?.removeChild(container)
}

async function getFocusBlockUid(entity: Page) {
    const value = await config.get('focusBlockUid')
    // strip parents if present
    return value?.replace(/^\(\(/, '').replace(/\)\)$/, '')
}

const renderPriorityItemForDailyPages = async (container: HTMLElement) => {
    const entityUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid()
    console.log(`Setting up focus items for ${entityUid}`)
    if (!entityUid) return
    const entity = RoamEntity.fromUid(entityUid)
    const shouldSkipRendering = !entity || !(entity instanceof Page)
    if (shouldSkipRendering) {
        console.log('Skipping rendering of focus item for non-daily page', entityUid, entity?.text)
        return
    }

    const blockOfInterest = await getFocusBlockUid(entity)

    ReactDOM.render(<div
        css={{
            marginTop: '1em',
            marginBottom: '1em',
            paddingBottom: '1em',
            borderRadius: '5px',
            border: '1px solid rgba(0,0,0,0.1)',
            boxShadow: '0 0 5px 0 rgba(0,0,0,0.2)',

        }}
    >
        {blockOfInterest && <Block uid={blockOfInterest}/>}
    </div>, container)
}
