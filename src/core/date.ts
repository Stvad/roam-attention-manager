import {RoamDate} from 'roam-api-wrappers/dist/date'
import {Block} from 'roam-api-wrappers/dist/data'

const applyToDate = (date: Date, modifier: (input: number) => number): Date => {
    const newDate = new Date(date)
    newDate.setDate(modifier(date.getDate()))
    return newDate
}

export const createModifier = (change: number) => (num: number) => num + change

export const daysFromNow = (days: number) => applyToDate(new Date(), createModifier(days))

export function modifyDateInBlock(blockUid: string, modifier: (input: number) => number, initWithTodayIfMissing = false) {
    replaceDateInBlock(blockUid, (oldDate) => applyToDate(oldDate, modifier), initWithTodayIfMissing)
}

export const replaceDateInBlock = (blockUid: string, transformer: (oldDate: Date) => Date, initWithTodayIfMissing = false) => {
    const block = Block.fromUid(blockUid)

    const datesInContent = block.text.match(RoamDate.referenceRegex)
    if (!datesInContent) {
        if (initWithTodayIfMissing) {
            block.text = block.text + ' ' + RoamDate.toDatePage(new Date())
        }
        return
    }

    block.text = block.text.replace(
        datesInContent[0],
        RoamDate.toDatePage(transformer(RoamDate.parseFromReference(datesInContent[0]))),
    )
}


export const addDays = (date: Date, days: number) => applyToDate(date, createModifier(days))

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const getDayName = (date: Date) => days[date.getDay()]
