'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AiRuntimeService } = require('../src/ai/ai-runtime-service.cjs');
const { OllamaProvider } = require('../src/ai/providers/ollama-provider.cjs');

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function createLocalFetch() {
  const calls = [];
  const fetchImpl = async (target) => {
    const pathname = new URL(target).pathname;
    calls.push(pathname);
    if (pathname === '/api/version') return jsonResponse({ version: '0.12.3-test' });
    if (pathname === '/api/tags') {
      return jsonResponse({
        models: [{
          name: 'local-test:latest',
          model: 'local-test:latest',
          size: 1024,
          details: { family: 'synthetic' }
        }]
      });
    }
    if (pathname === '/api/show') return jsonResponse({ capabilities: ['completion'] });
    if (pathname === '/api/chat') return jsonResponse({ message: { content: 'should not be reached' } });
    return new Response('{}', { status: 404 });
  };
  return { calls, fetchImpl };
}

test('remote-backed Ollama model summaries are excluded from local discovery', async () => {
  const { fetchImpl } = createLocalFetch();
  const provider = new OllamaProvider({
    fetchImpl: async (target, options) => {
      if (new URL(target).pathname === '/api/tags') {
        return jsonResponse({
          models: [{
            name: 'innocent-alias:latest',
            model: 'innocent-alias:latest',
            remote_model: 'glm-4.7:cloud',
            remote_host: 'https://ollama.com',
            size: 0,
            details: {}
          }]
        });
      }
      return fetchImpl(target, options);
    }
  });

  const status = await provider.getStatus();
  assert.equal(status.state, 'no-model');
});

test('remote backing revealed by model details is rejected before chat inference', async () => {
  const { calls, fetchImpl } = createLocalFetch();
  const provider = new OllamaProvider({
    fetchImpl: async (target, options) => {
      if (new URL(target).pathname === '/api/show') {
        return jsonResponse({
          capabilities: ['completion'],
          remote_model: 'glm-4.7:cloud',
          remote_host: 'https://ollama.com'
        });
      }
      return fetchImpl(target, options);
    }
  });

  const result = await new AiRuntimeService({ provider }).generate({
    model: 'local-test:latest',
    input: 'Synthetic prompt.'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, 'unsupported');
  assert.equal(calls.includes('/api/chat'), false);
});
