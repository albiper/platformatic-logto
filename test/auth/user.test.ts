import { test } from 'tap';
import { equal, deepEqual } from 'node:assert'
import { authBaseConfig, getServer } from '../helper.js'
import pltLogto from '../../src/index.js';

test('user access', async (t) => {
    const unauthorizedToken = {
        'X-PLATFORMATIC-USER-ID': 42,
        'X-PLATFORMATIC-ROLE': 'user',
    };

    const authorizedToken = {
        'X-PLATFORMATIC-USER-ID': 42,
        'X-PLATFORMATIC-ROLE': 'Supercow',
    };

    const app = await getServer(t);
    app.register(pltLogto, authBaseConfig);
    t.after(() => {
        app.close()
    });

    await app.ready();

    t.test('user access GET denied', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/pages',
            headers: {
                authorization: `Bearer ${app.jwt.sign(unauthorizedToken)}`,
            },
        })

        equal(res.statusCode, 401, 'get pages status code')
    });

    t.test('user access POST denied', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/pages',
            headers: {
                authorization: `Bearer ${app.jwt.sign(unauthorizedToken)}`,
            },
            body: {
                id: 1,
                titile: 'page 1'
            }
        })

        equal(res.statusCode, 401, 'POST pages status code')
    });

    t.test('user access GET allowed', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/pages',
            headers: {
                authorization: `Bearer ${app.jwt.sign(authorizedToken)}`,
            },
        });

        equal(res.statusCode, 200, 'get pages status code')
        deepEqual(res.json(), [], 'get pages response')
    });

    t.test('user access POST allowed', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/pages',
            headers: {
                authorization: `Bearer ${app.jwt.sign(authorizedToken)}`,
            },
            body: {
                title: 'page 1'
            }
        })

        equal(res.statusCode, 200, 'POST pages status code')
        deepEqual(res.json(), {
            id: 1,
            title: 'page 1',
            userId: null
        }, 'POST pages response')
    });

    t.test('user access PUT allowed', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/pages/1',
            headers: {
                authorization: `Bearer ${app.jwt.sign(authorizedToken)}`,
            },
            body: {
                title: 'page 1 modified'
            }
        })

        equal(res.statusCode, 200, 'PUT pages status code')
        deepEqual(res.json(), {
            id: 1,
            title: 'page 1 modified',
            userId: null
        }, 'PUT pages response')
    });

    t.test('user access DELETE allowed', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/pages/1',
            headers: {
                authorization: `Bearer ${app.jwt.sign(authorizedToken)}`,
            }
        })

        equal(res.statusCode, 200, 'DELETE pages status code')
        deepEqual(res.json(), {
            id: 1,
            title: 'page 1 modified',
            userId: null
        }, 'DELETE pages response')

        const res1 = await app.inject({
            method: 'GET',
            url: '/pages',
            headers: {
                authorization: `Bearer ${app.jwt.sign(authorizedToken)}`,
            },
        });

        equal(res1.statusCode, 200, 'get pages status code')
        deepEqual(res1.json(), [], 'get pages response')
    });
});