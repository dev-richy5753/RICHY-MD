const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { runExtraCommand } = require('../src/commands/extras');
const { GROUP_CMDS, runGroupCommand } = require('../src/commands/group');

function commandContext({ args = [], isGroup = false } = {}) {
    const replies = [];
    const values = new Map();
    const settings = {
        get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
        set: (key, value) => values.set(key, value),
    };
    const m = {
        from: `test-${Math.random()}`,
        sender: '123456789@s.whatsapp.net',
        isGroup,
        reply: async (message) => replies.push(message),
    };
    return {
        replies,
        m,
        settings,
        context: { args, sock: {}, session: { settings, sessionId: 'test' }, owner: false },
    };
}

test('dadjoke randomly covers 40 different classics', async () => {
    const originalRandomInt = crypto.randomInt;
    const bounds = [];
    let index = 0;
    crypto.randomInt = (max) => {
        bounds.push(max);
        return index++ % max;
    };
    const replies = [];
    try {
        for (let i = 0; i < 40; i++) {
            const command = commandContext();
            await runExtraCommand('dadjoke', command.m, command.context);
            replies.push(command.replies[0]);
        }
    } finally {
        crypto.randomInt = originalRandomInt;
    }

    assert.equal(new Set(replies).size, 40);
    assert.deepEqual(new Set(bounds), new Set([40]));
});

test('password command keeps secrets out of group chats and respects the requested length', async () => {
    const group = commandContext({ args: ['16'], isGroup: true });
    await runExtraCommand('password', group.m, group.context);
    assert.match(group.replies[0], /private chat/);

    const direct = commandContext({ args: ['24'] });
    await runExtraCommand('password', direct.m, direct.context);
    const password = direct.replies[0].split('\n')[0].replace('🔐 ', '');
    assert.equal(password.length, 24);
});

test('currency command validates input and formats the returned conversion', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    global.fetch = async (input) => {
        const url = new URL(input);
        assert.equal(url.hostname, 'api.frankfurter.dev');
        assert.equal(url.searchParams.get('base'), 'USD');
        assert.equal(url.searchParams.get('symbols'), 'EUR');
        return { ok: true, json: async () => ({ date: '2026-03-01', rates: { EUR: 9.25 } }) };
    };

    const valid = commandContext({ args: ['10', 'USD', 'EUR'] });
    await runExtraCommand('currency', valid.m, valid.context);
    assert.match(valid.replies[0], /10 USD = 9\.25 EUR/);
    assert.match(valid.replies[0], /2026-03-01/);

    const invalid = commandContext({ args: ['-1', 'USD', 'EUR'] });
    await runExtraCommand('currency', invalid.m, invalid.context);
    assert.match(invalid.replies[0], /Usage:/);
});

test('anime lookup returns title metadata and a source link', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    global.fetch = async (input) => {
        const url = new URL(input);
        assert.equal(url.hostname, 'kitsu.io');
        assert.equal(url.pathname, '/api/edge/anime');
        assert.equal(url.searchParams.get('filter[text]'), 'KonoSuba');
        return {
            ok: true,
            json: async () => ({
                data: [{ attributes: {
                    canonicalTitle: 'KonoSuba',
                    startDate: '2016-01-13',
                    status: 'finished',
                    episodeCount: 10,
                    slug: 'kono-subarashii-sekai-ni-shukufuku-wo',
                } }],
            }),
        };
    };

    const lookup = commandContext({ args: ['KonoSuba'] });
    await runExtraCommand('anime', lookup.m, lookup.context);
    assert.match(lookup.replies[0], /KonoSuba\*? \(2016\)/);
    assert.match(lookup.replies[0], /Episodes: 10/);
    assert.match(lookup.replies[0], /kitsu\.io\/anime/);
});

test('waifu and Megumin commands return text-only character profiles', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    global.fetch = async (input) => {
        const url = new URL(input);
        assert.equal(url.hostname, 'kitsu.io');
        if (url.pathname.endsWith('/characters') && url.searchParams.has('filter[name]')) {
            assert.equal(url.searchParams.get('filter[name]'), 'Megumin');
        }
        return {
            ok: true,
            json: async () => ({
                data: [{
                    attributes: { name: 'Megumin', slug: 'megumin' },
                }],
            }),
        };
    };

    const waifu = commandContext();
    await runExtraCommand('waifu', waifu.m, waifu.context);
    assert.match(waifu.replies[0], /Megumin/);
    assert.match(waifu.replies[0], /kitsu\.io\/characters\/megumin/);

    const megumin = commandContext();
    await runExtraCommand('megumin', megumin.m, megumin.context);
    assert.match(megumin.replies[0], /kitsu\.io\/characters\/megumin/);
});

test('Wikipedia and dictionary handlers format successful lookup responses', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    global.fetch = async (input) => {
        const url = new URL(input);
        if (url.hostname === 'en.wikipedia.org') {
            return {
                ok: true,
                json: async () => ({
                    title: 'Albert Einstein',
                    description: 'German-born physicist',
                    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Albert_Einstein' } },
                }),
            };
        }
        assert.equal(url.hostname, 'api.datamuse.com');
        assert.equal(url.searchParams.get('sp'), 'hello');
        return { ok: true, json: async () => [{ word: 'hello', defs: ['n\tA greeting.'] }] };
    };

    const wiki = commandContext({ args: ['Albert', 'Einstein'] });
    await runExtraCommand('wiki', wiki.m, wiki.context);
    assert.match(wiki.replies[0], /Albert Einstein/);
    assert.match(wiki.replies[0], /wikipedia\.org\/wiki/);

    const definition = commandContext({ args: ['hello'] });
    await runExtraCommand('define', definition.m, definition.context);
    assert.match(definition.replies[0], /hello/);
    assert.match(definition.replies[0], /A greeting/);
});

test('styletext, would-you-rather, Hangman, and reminder alias execute their handlers', async () => {
    const styled = commandContext({ args: ['bold', 'hello'] });
    await runExtraCommand('styletext', styled.m, styled.context);
    assert.equal(styled.replies[0], '𝐡𝐞𝐥𝐥𝐨');

    const wyr = commandContext();
    await runExtraCommand('wyr', wyr.m, wyr.context);
    assert.match(wyr.replies[0], /^🤔 Would you rather /);

    const originalRandomInt = crypto.randomInt;
    crypto.randomInt = () => 0;
    try {
        const game = commandContext();
        await runExtraCommand('hangman', game.m, game.context);
        assert.match(game.replies[0], /_ _ _ _ _/);
        game.context.args = ['a'];
        await runExtraCommand('hangman', game.m, game.context);
        assert.match(game.replies[1], /a _ _ _ _/);
        game.context.args = ['quit'];
        await runExtraCommand('hangman', game.m, game.context);
        assert.match(game.replies[2], /anime/);
    } finally {
        crypto.randomInt = originalRandomInt;
    }

    const reminder = commandContext({ args: ['1d', 'test reminder'] });
    await runExtraCommand('reminder', reminder.m, reminder.context);
    assert.match(reminder.replies[0], /Reminder set/);
    const reminderId = reminder.replies[0].match(/ID: (\w+)/)?.[1];
    assert.ok(reminderId);
    reminder.context.args = [reminderId];
    await runExtraCommand('cancelreminder', reminder.m, reminder.context);
    assert.match(reminder.replies[1], /cancelled/);
    assert.deepEqual(reminder.settings.get('reminders', []), []);
});

test('group aliases route tag and grouplink to their existing actions', async () => {
    assert.ok(GROUP_CMDS.has('tag'));
    assert.ok(GROUP_CMDS.has('grouplink'));

    const groupJid = `test-${Math.random()}@g.us`;
    const calls = [];
    const sock = {
        user: { id: '999999999@s.whatsapp.net' },
        groupMetadata: async () => ({
            participants: [{ id: '999999999@s.whatsapp.net', admin: 'admin' }],
        }),
        groupInviteCode: async () => {
            calls.push('get');
            return 'current-code';
        },
        groupRevokeInvite: async () => {
            calls.push('revoke');
            return 'new-code';
        },
    };
    const replies = [];
    const m = { from: groupJid, isGroup: true, reply: async (value) => replies.push(value) };
    await runGroupCommand('grouplink', m, {
        sock, settings: { get: (_key, fallback) => fallback }, owner: true, args: [], P: '.', getQuotedMessage: async () => null,
    });
    assert.deepEqual(calls, ['get']);
    assert.match(replies[0], /current-code/);

    const tagSends = [];
    sock.groupMetadata = async () => ({ participants: [] });
    await runGroupCommand('tag', {
        ...m,
        send: async (value) => tagSends.push(value),
    }, {
        sock, settings: { get: (_key, fallback) => fallback }, owner: true, args: [], P: '.', getQuotedMessage: async () => null,
    });
    assert.match(tagSends[0].text, /Attention everyone/);
});
