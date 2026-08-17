'use strict';

const path = require('node:path');

const DEFAULT_ROOT_DIRECTORY = path.resolve(__dirname, '../..');

function loadEnvironment({
  rootDirectory = DEFAULT_ROOT_DIRECTORY,
  dotenv = require('dotenv')
} = {}) {
  const options = { override: false, quiet: true };
  const root = dotenv.config({
    path: path.join(rootDirectory, '.env'),
    ...options
  });
  const backend = dotenv.config({
    path: path.join(rootDirectory, 'backend', '.env'),
    ...options
  });
  return { root, backend };
}

module.exports = {
  DEFAULT_ROOT_DIRECTORY,
  loadEnvironment
};
