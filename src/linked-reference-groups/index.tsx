import * as ReactDOM from 'react-dom'
import {ReferenceGroups} from './reference-groups'
import {highPriorityPages} from './config'
import {OnloadArgs} from 'roamjs-components/types'
import 'arrive'

const containerClass = 'rm-reference-group-container'

export const setup = async (extensionAPI: OnloadArgs['extensionAPI']) => {
    const searchReferencesSelector = '.roam-article .rm-reference-main .rm-reference-container .flex-h-box .rm-mentions-search'

    document.arrive(
        searchReferencesSelector,
        {existing: true},
        async referenceSearch => {
            const container = document.createElement('div')
            container.className = containerClass + ', rm-mentions'
            referenceSearch.parentElement?.after(container)

            void renderGroupsForCurrentPage(container, extensionAPI)
        })
}

export const teardown = () => {
    const container = document.querySelector(`.${containerClass}`)
    container?.parentNode?.removeChild(container)
}
const renderGroupsForCurrentPage = async (container: HTMLElement, extensionAPI: OnloadArgs['extensionAPI']) => {
    const entityUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid()
    console.log(`Setting up reference groups for ${entityUid}`)
    if (!entityUid) return

    ReactDOM.render(<div
        css={{
            marginTop: '1em',
        }}
    >
        <ReferenceGroups entityUid={entityUid} highPriorityPages={highPriorityPages(extensionAPI)}/>
        <hr/>
    </div>, container)
}
