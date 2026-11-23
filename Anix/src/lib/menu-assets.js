const fs = require('fs');

const assets = new Map();

function loadMenuAsset(filePath) {
    let asset = assets.get(filePath);
    if (!asset) {
        asset = fs.readFileSync(filePath);
        assets.set(filePath, asset);
    }
    return asset;
}

module.exports = { loadMenuAsset };
