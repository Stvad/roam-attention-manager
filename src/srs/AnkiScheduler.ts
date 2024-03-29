import {RoamNode, SM2Node} from './SM2Node'
import {Scheduler, SRSSignal} from './scheduler'
import {randomFromInterval} from '../core/random'
import {addDays} from '../core/date'

/**
 * Again (1)
 * The card is placed into relearning mode, the ease is decreased by 20 percentage points
 * (that is, 20 is subtracted from the ease value, which is in units of percentage points), and the current interval is
 * multiplied by the value of new interval (this interval will be used when the card exits relearning mode).
 *
 * Hard (2)
 * The card’s ease is decreased by 15 percentage points and the current interval is multiplied by 1.2.
 *
 * Good (3)
 * The current interval is multiplied by the current ease. The ease is unchanged.
 *
 * Easy (4)
 * The current interval is multiplied by the current ease times the easy bonus and the ease is
 * increased by 15 percentage points.
 * For Hard, Good, and Easy, the next interval is additionally multiplied by the interval modifier.
 * If the card is being reviewed late, additional days will be added to the current interval, as described here.
 *
 * There are a few limitations on the scheduling values that cards can take.
 * Eases will never be decreased below 130%; SuperMemo’s research has shown that eases below 130% tend to result in
 * cards becoming due more often than is useful and annoying users.
 *
 * Source: https://docs.ankiweb.net/#/faqs?id=what-spaced-repetition-algorithm-does-anki-use
 */
export class AnkiScheduler implements Scheduler {
    static defaultFactor = 2.5
    static defaultInterval = 2

    static maxInterval = 50 * 365
    static minFactor = 1.3
    // todo experiment
    static hardFactor = 1.3
    static soonerFactor = 0.75
    static jitterPercentage = 0.05

    schedule(node: SM2Node, signal: SRSSignal): SM2Node {
        const newParams = this.getNewParameters(node, signal)

        const currentDate = new Date()
        return node
            .withInterval(newParams.interval)
            .withFactor(newParams.factor)
            .withDate(addDays(currentDate, Math.ceil(newParams.interval)))
    }

    getNewParameters(node: SM2Node, signal: SRSSignal) {
        const factor = node.factor || AnkiScheduler.defaultFactor
        const interval = node.interval || AnkiScheduler.defaultInterval

        let newFactor = factor
        let newInterval = interval

        const factorModifier = 0.15
        switch (signal) {
            case SRSSignal.AGAIN:
                newFactor = factor - 0.2
                newInterval = 1
                break
            case SRSSignal.HARD:
                newFactor = factor - factorModifier
                newInterval = interval * AnkiScheduler.hardFactor
                break
            case SRSSignal.GOOD:
                newInterval = interval * factor
                break
            case SRSSignal.EASY:
                newInterval = interval * factor
                newFactor = factor + factorModifier
                break
            case SRSSignal.SOONER:
                newInterval = interval * AnkiScheduler.soonerFactor
                break
        }

        return AnkiScheduler.enforceLimits(AnkiScheduler.addJitter(new SM2Params(newInterval, newFactor)))
    }

    private static addJitter(params: SM2Params) {
        // I wonder if i can make this "regressive" i.e. start with larger number &
        // reduce percentage, as the number grows higher
        const jitter = params.interval * AnkiScheduler.jitterPercentage
        return new SM2Params(params.interval + randomFromInterval(-jitter, jitter), params.factor)
    }

    private static enforceLimits(params: SM2Params) {
        return new SM2Params(
            Math.min(params.interval, AnkiScheduler.maxInterval),
            Math.max(params.factor, AnkiScheduler.minFactor),
        )
    }
}

export class AnkiAttentionScheduler extends AnkiScheduler {
    override schedule(node: SM2Node, signal: SRSSignal): SM2Node {
        return super.schedule(node, signal)
            .withTextTransformation((node: RoamNode) => node.text + ' *')
    }
}

class SM2Params {
    constructor(readonly interval: number, readonly factor: number) {
    }
}
