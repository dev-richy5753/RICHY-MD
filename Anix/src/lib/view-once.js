function findViewOnceMessage(message) {
    let current = message;
    for (let depth = 0; current && depth < 5; depth++) {
        const wrapped = current.viewOnceMessage?.message
            || current.viewOnceMessageV2?.message
            || current.viewOnceMessageV2Extension?.message;
        if (wrapped) return wrapped;
        if (current.imageMessage?.viewOnce || current.videoMessage?.viewOnce) return current;
        current = current.ephemeralMessage?.message
            || current.documentWithCaptionMessage?.message
            || current.editedMessage?.message;
    }
    return null;
}

module.exports = { findViewOnceMessage };
