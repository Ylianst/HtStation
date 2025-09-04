const fs = require('fs');
const path = require('path');

function loadConfig(configPath) {
    const absPath = path.resolve(configPath);
    if (!fs.existsSync(absPath)) {
        throw new Error(`Config file not found: ${absPath}`);
    }
    const lines = fs.readFileSync(absPath, 'utf8').split(/\r?\n/);
    const config = {};
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        config[key] = value;
    }
    return config;
}

module.exports = { loadConfig };
