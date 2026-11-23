const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function readSecret(filePath) {
    const secret = fs.readFileSync(filePath, 'utf8').trim();
    if (secret.length < 32) throw new Error(`Persistent app session secret is invalid: ${filePath}`);
    return secret;
}

function loadAppSessionSecret({
    configuredSecret = process.env.APP_SESSION_SECRET,
    filePath = path.join(process.cwd(), 'session', '.panel', 'app-session-secret'),
} = {}) {
    if (configuredSecret) return configuredSecret;

    try {
        return readSecret(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const secret = crypto.randomBytes(32).toString('hex');
    try {
        fs.writeFileSync(filePath, secret, { flag: 'wx', mode: 0o600 });
        return secret;
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        return readSecret(filePath);
    }
}

module.exports = { loadAppSessionSecret };
