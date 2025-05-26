import fastify from 'fastify';
import plugin from '../src/index';
import t from 'tap';

const app = fastify({

});

app.register(plugin, {
    auth: 'onstart',
    logtoAppId: 'x33chy0wqu70iwr1is2i0',
    logtoAppSecret: 'lQ7Jnme0z4xrlzAWPIAFirxjQAVf34xU',
    logtoBaseUrl: 'http://localhost:3000s'
});


app.addHook('onReady', async () => {
    t.pass('Listening')
});

app.listen({
    port: 3000,
    host: '0.0.0.0'
});

