import * as ReactDOM from 'react-dom'
import {ReferenceGroups} from './reference-groups'
import {highPriorityPages} from './config'
import {OnloadArgs} from 'roamjs-components/types'
import 'arrive'

// not specific enough - jumps to any mentions or query block
const controlsSelector = '.roam-article .rm-reference-main .rm-reference-container .flex-h-box .rm-mentions-search'


const containerClass = 'rm-reference-group-container'

const commandLabel = 'Trigger Reference Groups'

export const setup = async (extensionAPI: OnloadArgs['extensionAPI']) => {

    document.arrive(
        // controlsSelector,
        "#app > div > div > div.flex-h-box > div.roam-main > div.roam-body-main > div > div > div:nth-child(2) > div > div > div.rm-reference-container",
        {existing: true, fireOnAttributesModification: true},
        async referenceSearch => {
            const container = document.createElement('div')
            container.className = containerClass + ', rm-mentions'
            // referenceSearch.parentElement?.after(container)
            referenceSearch.insertBefore(container, referenceSearch.childNodes[1])

            void renderGroupsForCurrentPage(container, extensionAPI)

        })

    // window.addEventListener('load', () => console.log('loaded'))
    // window.addEventListener('hashchange', () => renderGroupsForCurrentPage(extensionAPI))
    // window.roamAlphaAPI.ui.commandPalette.addCommand({
    //     label: commandLabel,
    //     callback: () => renderGroupsForCurrentPage(container, extensionAPI),
    // })
}

export const teardown = () => {
    const container = document.querySelector(`.${containerClass}`)
    container?.parentNode?.removeChild(container)

    window.roamAlphaAPI.ui.commandPalette.removeCommand({label: commandLabel})
}
const renderGroupsForCurrentPage = async (container: HTMLElement, extensionAPI: OnloadArgs['extensionAPI']) => {
    const entityUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid()
    console.log(`Setting up reference groups for ${entityUid}`)
    if (!entityUid) return

    // const container = createContainer()
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
    const controls = document.querySelector(controlsSelector)
    if (!controls) {
        console.error(`Could not find controls element with selector ${controlsSelector}`)
        // await waitForElement(controlsSelector)
    }
    controls?.after(container)

    return container
}
