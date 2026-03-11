/**
 * ai-client.js — PetabyteAi Frontend AI Client
 * Reads real-time SSE stream from backend — each word appears as OpenAI generates it.
 * Auto-falls back to MockAI if server is offline or has no API key.
 */

const AIClient = {
    BACKEND_URL: 'http://localhost:3001',
    _mode: null,
    _modelName: null,

    /** Check backend health once, cache result */
    async checkBackend() {
        if (this._mode !== null) return this._mode;
        try {
            const res = await fetch(`${this.BACKEND_URL}/api/health`, {
                signal: AbortSignal.timeout(3000)
            });
            const data = await res.json();
            this._mode = data.mode;
            this._modelName = data.model;
            console.log(`[AIClient] ${data.message}`);
        } catch (e) {
            this._mode = 'mock';
            console.log('[AIClient] Server offline → MockAI');
        }
        return this._mode;
    },

    /**
     * Run AI skill — drop-in replacement for MockAI.run()
     * @param {string}   skillId
     * @param {string}   prompt
     * @param {string}   systemPrompt
     * @param {Function} onChunk(text)  — called with each text chunk as it arrives
     * @param {Function} onDone(result) — { inputTokens, outputTokens, cost, durationMs }
     * @param {object}   rates          — { inputRate, outputRate }
     */
    async run(skillId, prompt, systemPrompt, onChunk, onDone, rates) {
        const mode = await this.checkBackend();
        if (mode === 'openai') {
            await this._streamFromBackend(skillId, prompt, systemPrompt, onChunk, onDone, rates);
        } else {
            await MockAI.run(skillId, prompt, onChunk, onDone);
        }
    },

    /** Read SSE stream from backend in real-time */
    async _streamFromBackend(skillId, prompt, systemPrompt, onChunk, onDone, rates) {
        const startTime = Date.now();
        const inputRate = (rates && rates.inputRate) || 0.50;
        const outputRate = (rates && rates.outputRate) || 1.50;

        try {
            const res = await fetch(`${this.BACKEND_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ skillId, prompt, systemPrompt, inputRate, outputRate }),
                signal: AbortSignal.timeout(90000)
            });

            // Read SSE line-by-line
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep incomplete last line

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    let event;
                    try { event = JSON.parse(line.slice(6)); } catch (e) { continue; }

                    if (event.type === 'chunk') {
                        // Real OpenAI token — send directly to UI (no extra delay)
                        onChunk(event.text);

                    } else if (event.type === 'done') {
                        await onDone({
                            inputTokens: event.inputTokens,
                            outputTokens: event.outputTokens,
                            cost: event.cost,
                            durationMs: Date.now() - startTime,
                        });

                    } else if (event.type === 'use_mock' || event.type === 'error') {
                        // Fallback to mock
                        this._mode = 'mock';
                        console.warn('[AIClient] Falling back to MockAI:', event.reason || event.error);
                        await MockAI.run(skillId, prompt, onChunk, onDone);
                        return;
                    }
                }
            }

        } catch (err) {
            console.error('[AIClient] Stream error:', err.message);
            this._mode = 'mock';
            await MockAI.run(skillId, prompt, onChunk, onDone);
        }
    },

    getMode() { return this._mode; },
    getModelName() { return this._modelName; },
};
