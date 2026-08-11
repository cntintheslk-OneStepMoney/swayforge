'use strict';

const IPC_CHANNELS = Object.freeze({
  applicationInfo: 'swayforge:application-info',
  healthCheck: 'swayforge:health-check'
});

const BRIDGE_NAME = 'swayForge';
const HEALTH_REQUEST = Object.freeze({ kind: 'renderer-health-check', version: 1 });

function isHealthRequest(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 2 &&
      value.kind === HEALTH_REQUEST.kind &&
      value.version === HEALTH_REQUEST.version
  );
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
  BRIDGE_NAME,
  HEALTH_REQUEST,
  IPC_CHANNELS,
  createApplicationInfo,
  isHealthRequest
};
