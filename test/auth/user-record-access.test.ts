

import { test } from 'tap';
import { equal, deepEqual } from 'node:assert'
import { adminSecret, authBaseConfig, getServer } from '../helper.js'
import pltLogto from '../../src/index.js';

test('user record access', async (t) => {
    const user1 = {
        'X-PLATFORMATIC-USER-ID': 1,
        'X-PLATFORMATIC-ROLE': 'Supercow',
    };

    const user2 = {
        'X-PLATFORMATIC-USER-ID': 42,
        'X-PLATFORMATIC-ROLE': 'Supercow',
    };

    const app = await getServer(t);
    app.register(pltLogto, { ...authBaseConfig, defaults: true, checks: true });
    t.after(() => {
        app.close()
    });

    await app.ready();

    t.test('user 1 POST page', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/pages',
            headers: {
                authorization: `Bearer ${app.jwt.sign(user1)}`,
            },
            body: {
                title: 'page 1'
            }
        })

        equal(res.statusCode, 200, 'user 1 POST page status code')
        deepEqual(res.json(), {
            id: 1,
            title: 'page 1',
            userId: user1['X-PLATFORMATIC-USER-ID']
        }, 'POST pages response')
    });

    t.test('user 2 POST page', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/pages',
            headers: {
                authorization: `Bearer ${app.jwt.sign(user2)}`,
            },
            body: {
                title: 'page 2'
            }
        })

        equal(res.statusCode, 200, 'user 2 POST page status code')
        deepEqual(res.json(), {
            id: 2,
            title: 'page 2',
            userId: user2['X-PLATFORMATIC-USER-ID']
        }, 'POST pages response')
    });

    t.test('user 1 GET pages', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/pages',
            headers: {
                authorization: `Bearer ${app.jwt.sign(user1)}`,
            },
        });

        equal(res.statusCode, 200, 'get pages status code')
        deepEqual(res.json(), [
            {
                id: 1,
                title: 'page 1',
                userId: user1['X-PLATFORMATIC-USER-ID']
            }
        ], 'get pages response')
    });

    t.test('user 2 GET pages', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/pages',
            headers: {
                authorization: `Bearer ${app.jwt.sign(user2)}`,
            },
        });

        equal(res.statusCode, 200, 'get pages status code')
        deepEqual(res.json(), [
            {
                id: 2,
                title: 'page 2',
                userId: user2['X-PLATFORMATIC-USER-ID']
            }
        ], 'get pages response')
    });

    t.test('user1 cannot DELETE page of user2', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/pages/2',
            headers: {
                authorization: `Bearer ${app.jwt.sign(user1)}`,
            }
        })

        equal(res.statusCode, 404, 'user1 cannot DELETE page of user2 status code')
    });

    t.test('admin can DELETE page of other users', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/pages/2',
            headers: {
                'x-platformatic-admin-secret': adminSecret,
            }
        })

        equal(res.statusCode, 200, 'admin can DELETE page of other users status code')
        deepEqual(res.json(), {
            id: 2,
            title: 'page 2',
            userId: user2['X-PLATFORMATIC-USER-ID']
        }, 'DELETE pages response')

        const res1 = await app.inject({
            method: 'GET',
            url: '/pages',
            headers: {
                'x-platformatic-admin-secret': adminSecret,
            },
        });

        equal(res1.statusCode, 200, 'get pages status code')
        deepEqual(res1.json(), [{
            id: 1,
            title: 'page 1',
            userId: user1['X-PLATFORMATIC-USER-ID']
        }], 'get pages response')
    });
});