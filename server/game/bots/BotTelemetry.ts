/**
 * Opt-in decision telemetry.
 *
 * Measuring a bot change tells you WHETHER it moved the win rate. It never
 * tells you what the bot actually did, and every rejected lever in
 * `docs/bot-v2-rejected-experiments.md` was rejected without that second
 * answer — which is why several of them were re-proposed later in a new shape.
 *
 * This sink exists so a decision site can describe itself once, cheaply, and a
 * probe script can then reconstruct the population a lever acts on: how often
 * the window opens, what it costs when it fires, and what the board looked
 * like. It is NOT a logger — nothing here writes anywhere by default.
 *
 * Cost when disabled is one static boolean read. Callers pass a THUNK, so the
 * payload object is never built unless a sink is attached; a call site may also
 * guard an expensive computation with `BotTelemetry.enabled` directly.
 */
export interface TelemetryEvent {
    kind: string;
    [key: string]: unknown;
}

export type TelemetrySink = (event: TelemetryEvent) => void;

export class BotTelemetry {
    /** Read this before computing anything expensive for a `record` call. */
    public static enabled = false;

    private static sink: TelemetrySink | null = null;

    public static attach(sink: TelemetrySink): void {
        BotTelemetry.sink = sink;
        BotTelemetry.enabled = true;
    }

    public static detach(): void {
        BotTelemetry.sink = null;
        BotTelemetry.enabled = false;
    }

    public static record(kind: string, payload: () => Record<string, unknown>): void {
        if(!BotTelemetry.enabled || !BotTelemetry.sink) {
            return;
        }
        try {
            BotTelemetry.sink(Object.assign({ kind: kind }, payload()) as TelemetryEvent);
        } catch {
            // A probe must never be able to change the game it is measuring.
        }
    }
}
