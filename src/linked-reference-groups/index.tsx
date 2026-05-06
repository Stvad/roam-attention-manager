import * as ReactDOM from 'react-dom'
import {ReferenceGroups} from './reference-groups'
import {Config} from './config'
import {OnloadArgs} from 'roamjs-components/types'
import 'arrive'

const containerClass = 'rm-reference-group-container'
const legacyContainerClass = `${containerClass},`

export const setup = async (extensionAPI: OnloadArgs['extensionAPI']) => {
    const searchReferencesSelector = '.roam-article .rm-reference-main .rm-reference-container .flex-h-box .rm-mentions-search'

    document.arrive(
        searchReferencesSelector,
        {existing: true},
        async referenceSearch => {
            const referenceSearchParent = referenceSearch.parentElement
            const containerParent = referenceSearchParent?.parentElement
            if (!referenceSearchParent || !containerParent) return

            const existingContainer = [...containerParent.children]
                .find(child =>
                    child.classList.contains(containerClass) ||
                    child.classList.contains(legacyContainerClass)) as HTMLElement | undefined
            if (existingContainer) {
                existingContainer.className = `${containerClass} rm-mentions`
                void renderGroupsForCurrentPage(existingContainer, extensionAPI)
                return
            }

            const container = document.createElement('div')
            container.className = `${containerClass} rm-mentions`
            referenceSearchParent.after(container)

            void renderGroupsForCurrentPage(container, extensionAPI)
        })
}

export const teardown = () => {
    document
        .querySelectorAll(`.${containerClass}, [class~="${legacyContainerClass}"]`)
        .forEach(container => {
            ReactDOM.unmountComponentAtNode(container)
            container.parentNode?.removeChild(container)
        })
}
const renderGroupsForCurrentPage = async (container: HTMLElement, extensionAPI: OnloadArgs['extensionAPI']) => {
    const entityUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid()
    console.log(`Setting up reference groups for ${entityUid}`)
    if (!entityUid) return

    const config = new Config(extensionAPI)
    ReactDOM.render(<div
        css={{
            marginTop: '1em',
        }}
    >
        <ReferenceGroups entityUid={entityUid} highPriorityPages={config.highPriorityPages} lowPriorityPages={config.lowPriorityPages} dontGroupThreshold={config.dontGroupThreshold}/>
        <hr/>
    </div>, container)
}
