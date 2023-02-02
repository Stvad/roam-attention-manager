import * as ReactDOM from 'react-dom'
import {ReferenceGroups} from './reference-groups'

const containerClass = 'rm-reference-group-container'

export const setup = async () => {
    void renderGroupsForCurrentPage()

    window.addEventListener('hashchange', renderGroupsForCurrentPage)
}

export const teardown = () => {
    const container = document.querySelector(`.${containerClass}`)
    container?.parentNode?.removeChild(container)
}
const renderGroupsForCurrentPage = async () => {
    const entityUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid()
    console.log(`Setting up reference groups for ${entityUid}`)
    if (!entityUid) return

    const container = createContainer()
    ReactDOM.render(<div
        css={{
            marginTop: '1em',
        }}
    >
        <ReferenceGroups entityUid={entityUid}/>
        <hr/>
    </div>, container)
}

function createContainer() {
    const container = document.createElement('div')
    container.className = containerClass + ', rm-mentions'
    // not specific enough - jumps to any mentions or query block
    const controlsSelector = '.rm-reference-main .rm-reference-container .flex-h-box'
    const controls = document.querySelector(controlsSelector)
    controls?.after(container)

    return container
}
