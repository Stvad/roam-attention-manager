import hotkeys from 'hotkeys-js'

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
