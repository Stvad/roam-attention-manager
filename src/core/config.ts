import hotkeys from 'hotkeys-js'
import {useState} from 'react'
import {OnloadArgs} from 'roamjs-components/types'

export interface Setting {
    type: string
    id: string
    label?: string
    initValue?: string
    placeholder?: string
    description?: string
    onPress(): void
    onSave?: (value: string) => void
}

export type Feature = {
    id: string
    name: string
    description?: string
    warning?: string
    settings?: Setting[]
    toggleable?: boolean
    enabledByDefault?: boolean
    toggle?: (active: boolean) => void
}

export const setupFeatureShortcuts = (feature: Feature) => {
    // todo need a better way to go about this, it seems like a bad way to configure things
    hotkeys.filter = () => true

    feature.settings?.forEach(it => hotkeys(it?.initValue!, it.onPress))
}


export class ExtensionConfig {
    constructor(readonly extensionAPI: OnloadArgs['extensionAPI']) {
    }

    useConfigState<T>(name: string, initial: T): [T, (value: T) => void]
    useConfigState<T = undefined>(name: string, initial?: T): [T | undefined, (value: T | undefined) => void] {
        const initialValue = this.get(name, initial)
        // todo plausibly get should be delegated to classes get bc rn assumption is that the thing is not updated elsewhere

        const [get, set] = useState(initialValue)

        return [get, (value: T | undefined) => {
            set(value)
            this.extensionAPI.settings.set(name, JSON.stringify({value}))
        }]
    }

    get<T>(name: string, defaultValue?: T) {
        const wrapper = JSON.parse(this.extensionAPI.settings.get(name) as string || '{}')
        return wrapper?.value !== undefined ? wrapper?.value as T : defaultValue
    }
}
