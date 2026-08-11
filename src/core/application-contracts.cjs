'use strict';

const IPC_CHANNELS = Object.freeze({
  aiRuntimeRefresh: 'swayforge:ai-runtime-refresh',
  aiRuntimeStatus: 'swayforge:ai-runtime-status',
  applicationInfo: 'swayforge:application-info',
  healthCheck: 'swayforge:health-check'
});

const BRIDGE_NAME = 'swayForge';
const HEALTH_REQUEST = Object.freeze({ kind: 'renderer-health-check', version: 1 });
const AI_STATUS_REQUEST = Object.freeze({ kind: 'ai-runtime-status', version: 1 });
const AI_REFRESH_REQUEST = Object.freeze({ kind: 'ai-runtime-refresh', version: 1 });

function isExactRequest(value, expected) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue)
  );
}

function isHealthRequest(value) {
  return isExactRequest(value, HEALTH_REQUEST);
}

function isAiStatusRequest(value) {
  return isExactRequest(value, AI_STATUS_REQUEST);
}

function isAiRefreshRequest(value) {
  return isExactRequest(value, AI_REFRESH_REQUEST);
}

function createApplicationInfo({ version, platform, architecture, electron, chrome, node }) {
  const values = { version, platform, architecture, electron, chrome, node };
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
      throw new TypeError(`Invalid application information field: ${key}`);
    }
  }

  return Object.freeze({ ...values });
}

module.exports = {
  AI_REFRESH_REQUEST,
  AI_STATUS_REQUEST,
  BRIDGE_NAME,
  HEALTH_REQUEST,
  IPC_CHANNELS,
  createApplicationInfo,
  isAiRefreshRequest,
  isAiStatusRequest,
  isHealthRequest
};
