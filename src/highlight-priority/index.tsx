import * as ReactDOM from 'react-dom'
import {RoamEntity, Page} from 'roam-api-wrappers/dist/data'
import {RoamStorage} from 'roam-api-wrappers/dist/storage'
import {RoamDate} from 'roam-api-wrappers/dist/date'
import {Block} from '../components/block'
import {config} from '../config'

const containerClass = 'priority-item-container'

export const setup = async () => {
    void renderPriorityItemForDailyPages()

    window.addEventListener('hashchange', renderPriorityItemForDailyPages)
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

const renderPriorityItemForDailyPages = async () => {
    const entityUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid()
    console.log(`Setting up focus items for ${entityUid}`)
    if (!entityUid) return
    const entity = RoamEntity.fromUid(entityUid)
    const shouldSkipRendering = !entity || !(entity instanceof Page) || !RoamDate.onlyPageTitleRegex.test(entity.text)
    if (shouldSkipRendering) {
        console.log('Skipping rendering of focus item for non-daily page', entityUid, entity?.text)
        return
    }

    const blockOfInterest = await getFocusBlockUid(entity)

    const container = await createContainer()

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

async function createContainer() {
    const container = document.createElement('div')
    container.className = containerClass + ', rm-mentions'
    const controlsSelector = '.rm-title-display'
    const controls = document.querySelector(controlsSelector)
    controls?.after(container)

    return container
}
