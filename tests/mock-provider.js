/**
 * mock-provider.js — Standalone Test Mock Provider for AnansiWorkbench acceptance tests.
 * Generates deterministic responses and realistic token/latency metadata for testing without network requests.
 */

(() => {
    'use strict';

    function generateMockResponse(messages, options = {}) {
        const lastMsg = messages && messages.length > 0 ? messages[messages.length - 1].content : '';
        const mockText = `[Mock Response] Received stimulus: "${lastMsg.slice(0, 40)}...". Generated with temperature ${options.temperature || 0.9}.`;

        return {
            text: mockText,
            modelUsed: options.modelIdentifier || 'mock-gemma-3',
            tokensIn: Math.floor(lastMsg.length / 4) + 10,
            tokensOut: Math.floor(mockText.length / 4) + 5,
            latencyMs: Math.floor(100 + Math.random() * 300),
            costUsd: 0.0,
        };
    }

    window.TestMockProvider = {
        generateMockResponse,
    };
})();
