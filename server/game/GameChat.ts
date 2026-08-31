type Player = {
    user: {
        username: string;
        emailHash: string;
        settings: {
            disableGravatar: boolean;
        };
    };
};

type MsgArg = string | { name: string } | { getShortSummary: () => string };

type MessageText = string | Array<string | number>;

/**
 * A card as the client needs it to render one: the shape getShortSummary() returns.
 */
export type RecordedCard = {
    id: string;
    name: string;
    uuid: string;
    type: string;
    packId?: string;
    element?: string;
};

/**
 * Structured companion to a log entry.
 *
 * The client used to re-derive all of this by parsing the formatted prose back apart --
 * which verb was used, which fragment was the source, which were targets. That works
 * only for entries whose text happens to follow the default shape, and it cannot
 * recover anything the text never mentions (conflict participants, covert pairings).
 * Emitting the facts alongside the words removes the guesswork.
 */
export type MessageRecord = {
    kind: 'play' | 'target' | 'conflict-declared' | 'conflict-covert' | 'conflict-defenders';
    player?: string;
    verb?: string;
    source?: RecordedCard;
    targets?: Array<RecordedCard>;
    /**
     * Cards spent to pay for the ability, as opposed to aimed at. A cost is not a
     * target, but it is still a card this ability reached out and touched, so the
     * client draws it the same way.
     */
    costs?: Array<RecordedCard>;
    conflictId?: number;
    conflictType?: string;
    ring?: RecordedCard;
    province?: RecordedCard;
    attackers?: Array<RecordedCard>;
    defenders?: Array<RecordedCard>;
    covert?: Array<{ source: RecordedCard; target: RecordedCard }>;
};

/**
 * getShortSummary() already returns exactly what the client needs to render a card --
 * id, name, uuid, type and packId (plus element for a ring) -- so a record carries that
 * and nothing more. Anything without one (a facedown province passed as its slot name,
 * say) records as undefined rather than as a broken half-card.
 */
export function recordCard(card: any): RecordedCard | undefined {
    return card && card.getShortSummary ? card.getShortSummary() : undefined;
}

export function recordCards(cards: Array<any>): Array<RecordedCard> {
    const recorded: Array<RecordedCard> = [];
    for(const card of cards || []) {
        const summary = recordCard(card);
        if(summary) {
            recorded.push(summary);
        }
    }
    return recorded;
}

export class GameChat {
    messages: Array<{
        date: Date;
        message: MessageText | { alert: { type: string; message: string | Array<string> } };
        record?: MessageRecord;
    }> = [];

    addChatMessage(player: Player, message: any): void {
        const playerArg = {
            name: player.user.username,
            emailHash: player.user.emailHash,
            noAvatar: player.user.settings.disableGravatar
        };

        this.addMessage('{0} {1}', playerArg, message);
    }

    addMessage(message: string, ...args: Array<MsgArg>): void {
        const formattedMessage = this.formatMessage(message, args);
        this.messages.push({ date: new Date(), message: formattedMessage });
    }

    /**
     * Attach a structured record to the entry just added. Kept separate from addMessage
     * so the hundreds of existing call sites stay untouched -- only the handful of
     * places the client needs to read precisely have to opt in.
     */
    attachRecord(record: MessageRecord): void {
        const last = this.messages[this.messages.length - 1];
        if(last) {
            last.record = record;
        }
    }

    addAlert(type: string, message: string, ...args: Array<MsgArg>): void {
        const formattedMessage = this.formatMessage(message, args);
        this.messages.push({ date: new Date(), message: { alert: { type: type, message: formattedMessage } } });
    }

    formatMessage(format: string, args: Array<MsgArg>): string | Array<string> {
        if(!format) {
            return '';
        }

        let fragments = format.split(/(\{\d+\})/);
        return fragments.reduce((output, fragment) => {
            let argMatch = fragment.match(/\{(\d+)\}/);
            if(argMatch && args) {
                let arg = args[argMatch[1]];
                if(arg || arg === 0) {
                    if(arg.message) {
                        return output.concat(arg.message);
                    } else if(Array.isArray(arg)) {
                        if(typeof arg[0] === 'string' && arg[0].includes('{')) {
                            return output.concat(this.formatMessage(arg[0], arg.slice(1)));
                        }
                        return output.concat(this.formatArray(arg));
                    } else if(arg.getShortSummary) {
                        return output.concat(arg.getShortSummary());
                    }
                    return output.concat(arg);
                }
            } else if(!argMatch && fragment) {
                let splitFragment = fragment.split(' ');
                let lastWord = splitFragment.pop();
                return splitFragment
                    .reduce((output, word) => {
                        return output.concat(word || [], ' ');
                    }, output)
                    .concat(lastWord || []);
            }
            return output;
        }, []);
    }

    formatArray(array: Array<MsgArg>): string | Array<string> {
        if(array.length === 0) {
            return [];
        }

        const format =
            array.length === 1
                ? '{0}'
                : array.length === 2
                    ? '{0} and {1}'
                    : Array.from({ length: array.length - 1 })
                        .map((_, idx) => `{${idx}}`)
                        .join(', ') + ` and {${array.length - 1}}`;

        return this.formatMessage(format, array);
    }
}
