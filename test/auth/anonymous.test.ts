import { test } from 'tap';
import { equal, deepEqual } from 'node:assert'
import { authBaseConfig, getServer } from '../helper.js'
import pltLogto from '../../src/index.js';

test('anonymous access', async (t) => {
    t.test('anonymous access allowed', async (t_allowed) => {
        const app = await getServer(t_allowed);
        app.register(pltLogto, { ...authBaseConfig, allowAnonymous: true });

        t_allowed.after(() => {
            app.close()
        });

        await app.ready();

        {
            const res = await app.inject({
                method: 'GET',
                url: '/pages',
            })

            equal(res.statusCode, 200, 'get pages status code')
            deepEqual(res.json(), [], 'get pages response')
        }
    });

    t.test('anonymous access denied', async (t_denied) => {
        const app = await getServer(t_denied);
        app.register(pltLogto, authBaseConfig);
        t_denied.after(() => {
            app.close()
        });

        await app.ready();

        {
            const res = await app.inject({
                method: 'GET',
                url: '/pages',
            })

            equal(res.statusCode, 401, 'get pages status code')
        }
    });
});