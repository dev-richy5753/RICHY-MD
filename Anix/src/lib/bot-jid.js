function getBotJid(sock) {
    const jid = sock?.user?.id;
    if (typeof jid !== 'string' || !jid.trim()) return null;
    return jid.replace(/:\d+(?=@)/, '');
}

module.exports = { getBotJid };
