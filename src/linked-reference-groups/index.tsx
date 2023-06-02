import * as ReactDOM from 'react-dom'
import {ReferenceGroups} from './reference-groups'
import {highPriorityPages} from './config'
import {OnloadArgs} from 'roamjs-components/types'

const containerClass = 'rm-reference-group-container'

const commandLabel = 'Trigger Reference Groups'

export const setup = async (extensionAPI: OnloadArgs['extensionAPI']) => {

    void renderGroupsForCurrentPage(extensionAPI)
    window.addEventListener('hashchange', () => renderGroupsForCurrentPage(extensionAPI))
    window.roamAlphaAPI.ui.commandPalette.addCommand({
        label: commandLabel,
        callback: () => renderGroupsForCurrentPage(extensionAPI),
    })
}

export const teardown = () => {
    const container = document.querySelector(`.${containerClass}`)
    container?.parentNode?.removeChild(container)

    window.roamAlphaAPI.ui.commandPalette.removeCommand({label: commandLabel})
}
const renderGroupsForCurrentPage = async (extensionAPI: OnloadArgs['extensionAPI']) => {
    const entityUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid()
    console.log(`Setting up reference groups for ${entityUid}`)
    if (!entityUid) return

    const container = createContainer()
    ReactDOM.render(<div
        css={{
            marginTop: '1em',
        }}
    >
        <ReferenceGroups entityUid={entityUid} highPriorityPages={highPriorityPages(extensionAPI)}/>
        <hr/>
    </div>, container)
}

function createContainer() {
    const container = document.createElement('div')
    container.className = containerClass + ', rm-mentions'
    // not specific enough - jumps to any mentions or query block
    const controlsSelector = '.rm-reference-main .rm-reference-container .flex-h-box'
    const controls = document.querySelector(controlsSelector)
    if (!controls) {
        console.error(`Could not find controls element with selector ${controlsSelector}`)
        // await waitForElement(controlsSelector)
    }
    controls?.after(container)

    return container
}
