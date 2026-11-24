const fs = require('fs');
const path = require('path');
const { loadMenuAsset } = require('./menu-assets');

const IMAGE_DIRECTORY = path.join(__dirname, '..', '..', 'assets', 'images');
const EXCLUDED_IMAGES = new Set([
    'Black_Bull_members.webp',
    'Zagred_profile.webp',
    'richy-md-icon.png',
    'who-in-the-black-bulls-do-you-think-youd-make-friends-with-v0-o0nj9fl10zud1.jpeg',
]);
const imagesByDirectory = new Map();

function randomZenonImage(directory = IMAGE_DIRECTORY, random = Math.random) {
    let images = imagesByDirectory.get(directory);
    if (!images) {
        images = fs.readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.isFile()
                && /\.(?:jpe?g|png|webp)$/i.test(entry.name)
                && !EXCLUDED_IMAGES.has(entry.name))
            .map((entry) => path.join(directory, entry.name));
        imagesByDirectory.set(directory, images);
    }

    if (!images.length) {
        throw new Error(`No Zenon reply images found in ${directory}`);
    }

    const index = Math.min(Math.floor(random() * images.length), images.length - 1);
    return loadMenuAsset(images[index]);
}

module.exports = { randomZenonImage };
