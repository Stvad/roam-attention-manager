import React from 'react'
import ReactTags, {Tag} from 'react-tag-autocomplete'
import getAllPageNames from 'roamjs-components/queries/getAllPageNames'
import {OnloadArgs} from 'roamjs-components/types'
import {ExtensionConfig} from '../core/config'

const valuesConfigName = 'high-priority-tag-values'

export const highPriorityPages = (extensionAPI: OnloadArgs['extensionAPI']) => {
    const tags = new ExtensionConfig(extensionAPI).get<Tag[]>(valuesConfigName) || []
    console.log({tags })
    return tags.map((it: Tag) => new RegExp(`^${it.name}$`))
}

export const panelConfig = (extensionAPI: OnloadArgs['extensionAPI']) => ({
    tabTitle: 'Grouping Configurations',
    settings: [
        {
            id: 'high-priority-tags',
            name: 'High priority tags',
            description: 'Things tagged with these pages will be grouped as high priority',
            action: {
                type: 'reactComponent',
                component: () => {
                    const [highPriorityTags, setPublicTags] = new ExtensionConfig(extensionAPI).useConfigState<Tag[]>(valuesConfigName, [{
                        id: 0,
                        name: 'i',
                    }])

                    const allPageTags = getAllPageNames().map(it => ({name: it, id: it}))

                    return <TagInput minTags={1}
                                     suggestions={allPageTags}
                                     tags={highPriorityTags}
                                     setTags={setPublicTags}
                    />
                },
                // https://github.com/dvargas92495/roamjs-query-builder/blob/71d41f9d0f80dcf740ab5119e4458e91971e5ad2/src/components/QueryPagesPanel.tsx
            } as const,
        },
    ],
})

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
