import {defaultExclusions, groupByMostCommonReferences} from 'roam-api-wrappers/dist/data/collection'
import {RoamEntity} from 'roam-api-wrappers/dist/data'
import * as ReactDOM from 'react-dom'
import {Block} from './components/block'
import {useEffect, useState} from 'react'

const containerClass = 'rm-reference-group-container'

function createContainer() {
    const container = document.createElement('div')
    container.className = containerClass + ', rm-mentions'
    const containerSelector = '.rm-reference-main'
    const referenceMain = document.querySelector(containerSelector).firstElementChild
    if (referenceMain) {
        referenceMain.prepend(container)
    }

    return container
}

interface ReferenceGroupsProps {
    entityUid: string
    smallestGroupSize: number
}

function ReferenceGroups({entityUid, smallestGroupSize}: ReferenceGroupsProps) {
    const [renderGroups, setRenderGroups] = useState<[string, RoamEntity[]][]>([])
    // todo groups it collapsible and remember the state in local storage
    // todo refresh button

    function updateRenderGroups(refresh: boolean = false) {
        const entity = RoamEntity.fromUid(entityUid)
        const backlincks = entity?.backlinks
        // todo this is ugly?
        if (backlincks.length > 150 && !refresh) return

        // todo filter before grouping
        const groups = groupByMostCommonReferences(backlincks, [...defaultExclusions, new RegExp(`^${entity.text}$`)])
        // expose possible/hidden groups to user in ux and allow them to select which ones to render
        console.log({groups})
        setRenderGroups(Array.from(groups.entries()).filter(([_, entries]) => entries.length >= smallestGroupSize))
    }

    useEffect(() => {
        updateRenderGroups()
    }, [entityUid, smallestGroupSize])
    // todo loading indicator
    // todo if no groups are matching the size limit - show special message
    return <div className='reference-group-container'>
        <div className="reference-groups-header">
            <div>References grouped by most common pages</div>
            <button onClick={() => updateRenderGroups(true)}>refresh</button>
        </div>
        {renderGroups.map(([uid, entities]) =>
            <div className="reference-group" key={uid}>
                <div className="reference-group-header">{RoamEntity.fromUid(uid).text} ({entities.length})</div>
                <div className="reference-group-entities">
                    {entities.map(entity => <Block uid={entity.uid} key={entity.uid}/>)}
                </div>
            </div>)}
    </div>
}

ReferenceGroups.defaultProps = {
    smallestGroupSize: 3,
}

const renderGroupsForCurrentPage = async () => {
    const entityUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid()
    if (!entityUid) return

    const container = createContainer()
    ReactDOM.render(<ReferenceGroups entityUid={entityUid}/>, container)
}
export const setup = async () => {
    void renderGroupsForCurrentPage()

    window.addEventListener('hashchange', renderGroupsForCurrentPage)
}

export const teardown = () => {
    const container = document.querySelector(`.${containerClass}`)
    if (container) {
        container.parentNode.removeChild(container)
    }
}
