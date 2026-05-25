const fs = require('fs-extra');
const path = require('path');

let pinsFile = null;
let pinsData = null;
let writeQueue = Promise.resolve();

function init(userDir) {
    if (pinsFile) return;
    const storageDir = path.join(userDir, 'pebble-timeline');
    fs.ensureDirSync(storageDir);
    pinsFile = path.join(storageDir, 'timeline-pins.json');
    try {
        pinsData = fs.existsSync(pinsFile)
            ? JSON.parse(fs.readFileSync(pinsFile, 'utf8'))
            : {};
    } catch (e) {
        pinsData = {};
    }
}

// Compute the storage bucket key for a given config node, preferring the
// timeline token (or a per-message override) and falling back to the config
// node's own id so each config is isolated even without a token.
function resolveKey(configNode, override) {
    const token = override
        || (configNode && configNode.credentials && configNode.credentials.timelineToken);
    if (token) return String(token);
    if (configNode && configNode.id) return String(configNode.id);
    return 'local';
}

function getPins(key) {
    if (!pinsData) return [];
    return Array.isArray(pinsData[key]) ? pinsData[key].slice() : [];
}

function addPin(key, pin) {
    return enqueue(() => {
        if (!Array.isArray(pinsData[key])) pinsData[key] = [];
        pinsData[key] = pinsData[key].filter(p => p.id !== pin.id);
        pinsData[key].push({ ...pin, _stored: new Date().toISOString() });
        cleanupOldPins();
        return writeFile();
    });
}

function removePin(key, pinId) {
    return enqueue(() => {
        if (!Array.isArray(pinsData[key])) return false;
        const before = pinsData[key].length;
        pinsData[key] = pinsData[key].filter(p => p.id !== pinId);
        if (pinsData[key].length === before) return false;
        return writeFile().then(() => true);
    });
}

// Serialize all mutating operations through a single promise chain so
// concurrent add/delete invocations cannot race on the read-modify-write.
function enqueue(fn) {
    const next = writeQueue.then(fn, fn);
    writeQueue = next.catch(() => {});
    return next;
}

function cleanupOldPins() {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    for (const k of Object.keys(pinsData)) {
        if (!Array.isArray(pinsData[k])) {
            pinsData[k] = [];
            continue;
        }
        pinsData[k] = pinsData[k].filter(pin => {
            if (!pin || !pin._stored) return false;
            const d = new Date(pin._stored);
            return !isNaN(d.getTime()) && d >= oneMonthAgo;
        });
    }
}

function writeFile() {
    const tmp = pinsFile + '.tmp';
    const data = JSON.stringify(pinsData, null, 2);
    return new Promise((resolve, reject) => {
        fs.writeFile(tmp, data, (err) => {
            if (err) return reject(err);
            fs.rename(tmp, pinsFile, (err2) => err2 ? reject(err2) : resolve());
        });
    });
}

module.exports = { init, resolveKey, getPins, addPin, removePin };
