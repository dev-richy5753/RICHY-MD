const path = require('node:path');

function getStorageRoot(configuredRoot = process.env.SESSION_DIR, cwd = process.cwd()) {
    return path.resolve(cwd, configuredRoot || 'session');
}

module.exports = { getStorageRoot };
