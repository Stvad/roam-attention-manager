import React, {useState, useCallback} from 'react'
import {Button, Dialog, InputGroup, Classes} from '@blueprintjs/core'

interface PromptOptions {
    title: string
    message?: string
    defaultValue?: string
    inputType?: 'text' | 'number'
    confirmLabel?: string
    cancelLabel?: string
}

interface UsePromptDialogResult {
    openPrompt: (options: PromptOptions, onConfirm: (value: string) => void) => void
    PromptDialog: React.FC
}

export function usePromptDialog(): UsePromptDialogResult {
    const [isOpen, setIsOpen] = useState(false)
    const [value, setValue] = useState('')
    const [options, setOptions] = useState<PromptOptions>({title: ''})
    const [onConfirmCallback, setOnConfirmCallback] = useState<((value: string) => void) | null>(null)

    const openPrompt = useCallback((opts: PromptOptions, onConfirm: (value: string) => void) => {
        setOptions(opts)
        setValue(opts.defaultValue ?? '')
        setOnConfirmCallback(() => onConfirm)
        setIsOpen(true)
    }, [])

    const handleConfirm = useCallback(() => {
        onConfirmCallback?.(value)
        setIsOpen(false)
    }, [value, onConfirmCallback])

    const handleClose = useCallback(() => {
        setIsOpen(false)
    }, [])

    const PromptDialog: React.FC = () => (
        <Dialog
            isOpen={isOpen}
            onClose={handleClose}
            title={options.title}
        >
            <div className={Classes.DIALOG_BODY}>
                {options.message && <p>{options.message}</p>}
                <InputGroup
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                    type={options.inputType ?? 'text'}
                    autoFocus
                />
            </div>
            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <Button onClick={handleClose}>{options.cancelLabel ?? 'Cancel'}</Button>
                    <Button
                        onClick={handleConfirm}
                        style={{backgroundColor: '#2b6cb0', color: 'white'}}
                    >{options.confirmLabel ?? 'Confirm'}</Button>
                </div>
            </div>
        </Dialog>
    )

    return {openPrompt, PromptDialog}
}
