import {Page} from 'roam-api-wrappers/dist/data'
import {RoamStorage} from 'roam-api-wrappers/dist/storage'


export const configPageName = 'roam/js/attention'

export const config = new RoamStorage(configPageName)

export const createConfigPage = async (name = configPageName) => {
    return Page.getOrCreate(name)
}

