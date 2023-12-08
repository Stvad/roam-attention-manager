import React from 'react'
import ReactTags, {Tag} from 'react-tag-autocomplete'
import getAllPageNames from 'roamjs-components/queries/getAllPageNames'
import {OnloadArgs} from 'roamjs-components/types'
import {ExtensionConfig} from '../core/config'

const autoGroupingLimit = 'auto-grouping-limit'

const getAllPageTags = () => getAllPageNames().map(it => ({name: it, id: it}))

export const panelConfig = (extensionAPI: OnloadArgs['extensionAPI']) => new Config(extensionAPI).panelConfig

export class Config {
    constructor(private extensionAPI: OnloadArgs['extensionAPI']) {
    }

    keys = {
        highPriority: 'high-priority-tag-values',
        lowPriority: 'low-priority-tag-values',
    }

    get panelConfig() {
        return {
            tabTitle: 'Grouping Configurations',
            settings: [
                {
                    id: 'high-priority-tags',
                    name: 'High priority tags',
                    description: 'Things tagged with these pages will be grouped as high priority',
                    action: {
                        type: 'reactComponent',
                        component: () => {
                            return this.tagConfig(this.keys.highPriority)
                        },
                        // https://github.com/dvargas92495/roamjs-query-builder/blob/71d41f9d0f80dcf740ab5119e4458e91971e5ad2/src/components/QueryPagesPanel.tsx
                    } as const,
                },
                {
                    id: 'low-priority-tags',
                    name: 'Low priority tags',
                    description: 'Things tagged with these pages will be grouped as low priority',
                    action: {
                        type: 'reactComponent',
                        component: () => {
                            return this.tagConfig(this.keys.lowPriority)
                        },
                    } as const,
                },
                {
                    id: autoGroupingLimit,
                    name: 'Do not automatically run grouping if the number of backlinks is greater than',
                    description: 'Do not automatically run grouping if the number of backlinks is greater than',
                    action: {
                        type: 'input',
                        placeholder: '150',
                    } as const,
                },
            ],
        }
    }

    private tagConfig(writeConfigKey: string) {
        const [tags, setTags] =
            new ExtensionConfig(this.extensionAPI).useConfigState<Tag[]>(writeConfigKey, [{
                id: 0,
                name: 'task',
            }])

        return <TagInput minTags={1}
                         suggestions={getAllPageTags()}
                         tags={tags}
                         setTags={setTags}
        />
    }

    pagesFromKey(key: string) {
        const tags = new ExtensionConfig(this.extensionAPI).get<Tag[]>(key) || []
        console.log({tags})
        return tags.map((it: Tag) => new RegExp(`^${it.name}$`))
    }

    get highPriorityPages() {
        return this.pagesFromKey(this.keys.highPriority)
    }

    get dontGroupThreshold(): number {
        const rawValue = this.extensionAPI.settings.get(autoGroupingLimit)
        console.log({rawValue})
        return parseInt(rawValue as string ?? '150')
    }

    get lowPriorityPages() {
        return this.pagesFromKey(this.keys.lowPriority)
    }
}

interface TagInputProps {
    tags: Tag[]
    setTags: (tags: Tag[]) => void
    minTags?: number
    maxTags?: number
    disabled?: boolean
    suggestions?: Tag[]
    placeholderText?: string
}


export const TagInput = ({tags, setTags, minTags = 0, maxTags, disabled, ...restProps}: TagInputProps) => (<ReactTags
    tags={tags}
    onAddition={(tag: any) => [setTags([...tags, tag])]}
    onDelete={(i: number) => {
        if (!disabled) setTags([...tags.slice(0, i), ...tags.slice(i + 1)])
    }}
    // classNames={getClassNames(tags, minTags, disabled)}
    // inputAttributes={{disabled: disabled || (maxTags && tags.length >= maxTags)}}
    addOnBlur
    // removeButtonText={disabled ? '' : undefined}
    maxSuggestionsLength={99}
    minQueryLength={1}
    {...restProps}
/>)
