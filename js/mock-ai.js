/**
 * mock-ai.js — Mock OpenAI Agent Response Engine
 * Simulates AI responses with typewriter effect + token counting
 */

const MockAI = {
    /**
     * Simulate running an agent skill
     * @param {string} skillId
     * @param {string} prompt
     * @param {Function} onChunk - called with each text chunk (streaming effect)
     * @param {Function} onDone - called when complete with { inputTokens, outputTokens, durationMs }
     */
    async run(skillId, prompt, onChunk, onDone) {
        const skill = PRICING.skills.find(s => s.id === skillId);
        if (!skill) return;

        const startTime = Date.now();

        // Estimate input tokens
        const inputTokens = PRICING.estimateTokens(prompt) + PRICING.estimateTokens(skill.systemPrompt);

        // Pick a mock response
        const responses = skill.mockResponses;
        const mockText = responses[Math.floor(Math.random() * responses.length)];

        // Estimate output tokens
        const outputTokens = PRICING.estimateTokens(mockText);

        // Simulate thinking delay (500–1200ms)
        await this._delay(500 + Math.random() * 700);

        // Stream text character by character (grouped in small chunks)
        await this._streamText(mockText, onChunk, 18);

        const durationMs = Date.now() - startTime;
        await onDone({ inputTokens, outputTokens, durationMs });
    },

    /**
     * Stream text in small chunks with delay between them
     */
    async _streamText(text, onChunk, chunkSize = 15) {
        let i = 0;
        while (i < text.length) {
            const end = Math.min(i + chunkSize + Math.floor(Math.random() * 8), text.length);
            onChunk(text.slice(i, end));
            i = end;
            // Average typing speed ~50ms per chunk
            await this._delay(30 + Math.random() * 40);
        }
    },

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};
