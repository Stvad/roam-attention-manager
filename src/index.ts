import {RoamDate} from 'roam-api-wrappers/dist/date'

import runExtension from 'roamjs-components/util/runExtension'
import 'roamjs-components/types'
import createBlockObserver from 'roamjs-components/dom/createBlockObserver'
import createIconButton from 'roamjs-components/dom/createIconButton'
import getUids from 'roamjs-components/dom/getUids'

import {DatePanelOverlay} from './date-panel'

import './index.css'
import {disableNavigation, setupNavigation} from './navigation'
import {setup as setupFuzzies, disable as disableFuzzies} from './fuzzy-date'
import {setup as setupReferenceGroups} from './linked-reference-groups'
import {setup as setupHighlightPriority} from './highlight-priority'
import {setup as setupSRS} from './srs'
import {setup as setupIncDec} from './inc-dec-value'
import {createConfigPage} from './config'
import {panelConfig} from './linked-reference-groups/config'
import {addSwipeListeners} from './core/swipe'
import {Block} from 'roam-api-wrappers/dist/data'

const ID = 'attention-manager'

//todo this matches things that have a sub-node with date
const hasDateReferenced = (element: HTMLDivElement) =>
    RoamDate.regex.test(element.innerText)

const iconClass = 'roam-date-icon'

const iconAlreadyExists = (refElement: HTMLElement) =>
    refElement.parentElement?.querySelector(`.${iconClass}`)

function findDateRef(b: HTMLDivElement) {
    const refs = b.querySelectorAll('.rm-page-ref')
    const dateElement = [...refs].find(hasDateReferenced)
    return dateElement?.parentElement
}

const removeIconButtons = () =>
    document.querySelectorAll(`.${iconClass}`).forEach((i) => i.remove())


let observersToCleanup: MutationObserver[]
const cleanupBlockObservers = () => {
    observersToCleanup?.forEach((o) => o.disconnect())
}

const toggleDone = (blockUid: string) => {
    const block = Block.fromUid(blockUid)
    if (block.text.startsWith('{{[[DONE]]}} ')) {
        block.text = block.text.replace('{{[[DONE]]}} ', '')
    } else if (block.text.startsWith('{{[[TODO]]}} ')) {
        block.text = block.text.replace('{{[[TODO]]}} ', '{{[[DONE]]}} ')
    } else {
        block.text = '{{[[DONE]]}} ' + block.text
    }
}

export default runExtension({
    extensionId: ID,
    run: async ({extensionAPI}) => {
        extensionAPI.settings.panel.create(panelConfig(extensionAPI))
        await createConfigPage()
        setupNavigation()
        setupFuzzies()
        setupSRS()
        setupIncDec()

        //todo do the thing for a specific date object in a block
        observersToCleanup = createBlockObserver((b: HTMLDivElement) => {
            const blockUid = getUids(b).blockUid

            addSwipeListeners(b, {
                onSwipeLeft: () => {
                    DatePanelOverlay({blockUid})
                },
                onSwipeRight: () => {
                    toggleDone(blockUid)
                },
                stopPropagation: true,
            })

            if (!hasDateReferenced(b)) return

            const refElement = findDateRef(b)
            // no refs don't care. or probably want to have a loop here actually
            if (!refElement || iconAlreadyExists(refElement)) return

            const icon = createIconButton('calendar')
            icon.className = iconClass
            icon.addEventListener('mousedown', (e) => {
                e.stopPropagation()
                DatePanelOverlay({blockUid})
            })
            refElement.parentNode?.insertBefore(icon, refElement)
        })

        setupReferenceGroups(extensionAPI)
    },
    unload: () => {
        disableFuzzies()
        disableNavigation()
        removeIconButtons()
        cleanupBlockObservers()
    },
})

// top menu button example
// https://github.com/panterarocks49/autotag/blob/b7653297a57baebef64f18888a6c2c1e186fd19f/src/index.js
