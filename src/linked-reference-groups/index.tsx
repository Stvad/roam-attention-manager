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
    ReactDOM.render(<ReferenceGroups entityUid={entityUid}/>, container)
}

function createContainer() {
    const container = document.createElement('div')
    container.className = containerClass + ', rm-mentions'
    const containerSelector = '.rm-reference-main'
    const referenceMain = document.querySelector(containerSelector)?.firstElementChild
    if (referenceMain) {
        referenceMain.prepend(container)
    }

    return container
}
