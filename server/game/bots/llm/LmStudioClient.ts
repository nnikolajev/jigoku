export interface LmStudioOptions {
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Minimal client for LM Studio's OpenAI-compatible chat completions endpoint.
 * No streaming, low temperature, hard timeout per request.
 */
class LmStudioClient {
    readonly baseUrl: string;
    readonly model: string;
    private timeoutMs: number;

    constructor(options: LmStudioOptions = {}) {
        this.baseUrl = (options.baseUrl || 'http://localhost:1234').replace(/\/+$/, '');
        this.model = options.model || 'qwen/qwen3.5-9b';
        this.timeoutMs = options.timeoutMs || 60000;
    }

    private async request(messages: ChatMessage[], options: { timeoutMs?: number; maxTokens?: number } = {}): Promise<any> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
        try {
            const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages,
                    temperature: 0.1,
                    // Reasoning models (qwen3.x) burn thousands of tokens on
                    // the think channel before the answer appears in content;
                    // a small budget yields an empty content with
                    // finish_reason 'length'.
                    max_tokens: options.maxTokens || 12288,
                    stream: false
                }),
                signal: controller.signal
            });
            if(!response.ok) {
                throw new Error(`LM Studio HTTP ${response.status}`);
            }
            const body: any = await response.json();
            const message = body?.choices?.[0]?.message;
            if(!message) {
                throw new Error('LM Studio returned no message');
            }
            return message;
        } finally {
            clearTimeout(timer);
        }
    }

    async chat(messages: ChatMessage[], options: { timeoutMs?: number; maxTokens?: number } = {}): Promise<string> {
        const message = await this.request(messages, options);
        if(typeof message.content !== 'string') {
            throw new Error('LM Studio returned no message content');
        }
        return message.content;
    }

    async chatJson(messages: ChatMessage[], options: { timeoutMs?: number; maxTokens?: number } = {}): Promise<any> {
        const message = await this.request(messages, options);
        try {
            return LmStudioClient.extractJson(String(message.content || ''));
        } catch(err) {
            // Truncated answers sometimes leave the drafted JSON only in the
            // reasoning channel — salvage it from there before giving up.
            const reasoning = String(message.reasoning_content || message.reasoning || '');
            if(reasoning) {
                return LmStudioClient.extractJson(reasoning);
            }
            throw err;
        }
    }

    /**
     * Qwen-family models may emit `<think>...</think>` reasoning and prose
     * around the answer; strip the reasoning and parse the outermost JSON
     * object from what remains.
     */
    static extractJson(content: string): any {
        const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '');
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if(start === -1 || end <= start) {
            throw new SyntaxError('No JSON object in model output');
        }
        return JSON.parse(cleaned.slice(start, end + 1));
    }
}

export default LmStudioClient;
