'use strict';

const mediaFoundation = require('./preview-bootstrap.cjs');
const mediaIntegrity = require('./integrity-bootstrap.cjs');
const contentStudio = require('./content-workspace-bootstrap.cjs');

module.exports = Object.freeze({
  ...mediaFoundation,
  ...mediaIntegrity,
  ...contentStudio
});
