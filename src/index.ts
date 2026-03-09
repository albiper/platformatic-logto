import fp from 'fastify-plugin'
import * as fastifyUser from 'fastify-user'

import findRule from './utils/find-rule.js'
import { Unauthorized, UnauthorizedField, MissingNotNullableError, PermissionsOutdated } from './utils/errors.js'
import fastifyLogto, { LogtoFastifyConfig } from '@albirex/fastify-logto';
import fastifyRedis from '@fastify/redis';
import { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { FastifyUserPluginOptions } from 'fastify-user';
import type { Entity, PlatformaticContext } from '@platformatic/sql-mapper'

export { fastifyLogto } from '@albirex/fastify-logto';
export { incrementPermissionsVersion, deletePermissionsVersion } from './utils/permissions-version.js';

import { getRequestFromContext, getRoles, getScopes } from './utils/utils.js'
export { getRequestFromContext, getRoles } from './utils/utils.js'

const PLT_ADMIN_ROLE = 'platformatic-admin'
const PLT_ADMIN_SCOPES = '*'

export type EntityActions = 'find' | 'save' | 'insert' | 'updateMany' | 'delete';

export type PlatformaticRule = {
    role: string;
    entity?: string;
    entities?: string[];
    defaults?: Record<string, string>;
    checks?: boolean;
    find?: boolean;
    save?: boolean;
    delete?: boolean;
    [action: string]: unknown;
};

export type RedisConfig = {
    host?: string;
    port?: number;
    password?: string;
    username?: string;
    db?: number;
};

export type PlatformaticLogToRoleBasedAuthOptions = {
    logtoBaseUrl?: string;
    logtoAppId?: string;
    logtoAppSecret?: string;
    rolePath?: string;
    roleKey?: string;
    userPath?: string;
    userKey?: string;
}

export type PlatformaticLogToScopeBasedAuthOptions = {
    scopesPath?: string;
    scopesKey?: string;
}

export type PlatformaticLogtoAuthOptions = {
    adminSecret?: string;
    roleBasedAuth?: PlatformaticLogToRoleBasedAuthOptions,
    scopeBasedAuth?: PlatformaticLogToScopeBasedAuthOptions,
    fastifyLogTo?: LogtoFastifyConfig;
    checks?: boolean;
    defaults?: boolean;
    anonymousRole?: string;
    allowAnonymous?: boolean;
    jwtPlugin: FastifyUserPluginOptions;
    redis?: RedisConfig;
    enableTokenVersionCheck?: boolean;
    sessionVersionKey?: string;
};

export const platformaticLogto: FastifyPluginAsync<PlatformaticLogtoAuthOptions> = fp(async (app: FastifyInstance, opts: PlatformaticLogtoAuthOptions) => {
    app.decorate('platformaticLogTo', {
        opts
    })

    // Register Redis if configured
    if (opts.redis) {
        await app.register(fastifyRedis, {
            host: opts.redis.host || '127.0.0.1',
            port: opts.redis.port || 6379,
            password: opts.redis.password,
            username: opts.redis.username,
            db: opts.redis.db || 0,
        });
        app.log.info('Redis client registered for permissions version check');
    }

    if (opts.roleBasedAuth || opts.fastifyLogTo) {
        app.register(fastifyLogto, {
            endpoint: opts.roleBasedAuth.logtoBaseUrl || opts.fastifyLogTo.endpoint || 'https://auth.example.com',
            appId: opts.roleBasedAuth.logtoAppId || opts.fastifyLogTo.appId || 'your-app-id',
            appSecret: opts.roleBasedAuth.logtoAppSecret || opts.fastifyLogTo.appSecret || 'your-app-secret',
        });
    }

    await app.register(fastifyUser as unknown as FastifyPluginAsync, opts.jwtPlugin);

    const roleKey = opts.roleBasedAuth?.rolePath || opts.roleBasedAuth?.roleKey || 'X-PLATFORMATIC-ROLE';
    const scopesKey = opts.scopeBasedAuth.scopesPath || opts.scopeBasedAuth.scopesKey || 'X-PLATFORMATIC-SCOPES'
    const adminSecret = opts.adminSecret
    const isRolePath = !!opts.roleBasedAuth?.rolePath // if `true` the role is intepreted as path like `user.role`
    const anonymousRole = opts.anonymousRole || 'anonymous'

    app.decorateRequest('setupDBAuthorizationUser', setupUser)

    async function setupUser() {
        // if (!adminSecret) {
        await this.extractUser()
        // }

        let forceAdminRole = false
        if (adminSecret && this.headers['x-platformatic-admin-secret'] === adminSecret) {
            if (opts.jwtPlugin.jwt) {
                forceAdminRole = true
            } else {
                this.log.info('admin secret is valid')
                this.user = new Proxy(this.headers, {
                    get: (target, key) => {
                        let value;
                        if (!target[key.toString()]) {
                            const newKey = key.toString().toLowerCase()
                            value = target[newKey]
                        } else {
                            value = target[key.toString()]
                        }

                        if (!value && key.toString().toLowerCase() === roleKey.toLowerCase()) {
                            value = PLT_ADMIN_ROLE
                        }
                        return value
                    },
                })
            }
        } else {
            await checkPermissionsVersion(app, opts, this.user)
        }

        if (forceAdminRole) {
            // We replace just the role in `request.user`, all the rest is untouched
            if (opts.roleBasedAuth) {
                this.user = {
                    // ...request.user,
                    [roleKey]: this.headers['x-platformatic-role'] ? [this.headers['x-platformatic-role']] : [PLT_ADMIN_ROLE]
                }
            }

            if (opts.scopeBasedAuth) {
                this.user = {
                    // ...request.user,
                    [scopesKey]: this.headers['x-platformatic-scopes'] ? [this.headers['x-platformatic-scopes']] : [PLT_ADMIN_SCOPES]
                }
            }
        }
    }

    async function roleBasedAuth() {
        const userKey = opts.roleBasedAuth.userKey || opts.roleBasedAuth.userPath || 'X-PLATFORMATIC-USER-ID';

        async function composeLogToRules() {
            const rolesResp = await app.logto.callAPI('/api/roles?type=User', 'GET');

            if (!rolesResp.ok) {
                throw rolesResp;
            }

            const roles = await rolesResp.json();
            const rules: PlatformaticRule[] = [{
                role: anonymousRole,
                entities: Object.keys(app.platformatic.entities),
                find: opts.allowAnonymous,
                save: opts.allowAnonymous,
                delete: opts.allowAnonymous,
            }];

            for (const role of roles) {
                const scopesResp = await app.logto.callAPI(`/api/roles/${role.id}/scopes`, 'GET');

                if (!scopesResp.ok) {
                    throw scopesResp;
                }

                const scopes = await scopesResp.json();

                for (const scope of scopes) {
                    const roleName = role.name;
                    // eslint-disable-next-line prefer-const
                    let [scopeAction, entity] = scope.name.split(':');

                    if (!app.platformatic.entities[entity]) {
                        app.log.debug(`Unknown entity '${entity}' in authorization rule`)
                        continue;
                    }

                    switch (scopeAction) {
                        case 'create':
                            scopeAction = 'save'
                            break;
                        case 'read':
                            scopeAction = 'find'
                            break;
                        case 'update':
                            scopeAction = 'updateMany'
                            break;
                    }

                    const checkExists = rules.find(r => r.role === roleName && r.entity === entity);
                    if (checkExists) {
                        if (opts.checks) {
                            checkExists[scopeAction] = {
                                checks: {
                                    userId: userKey
                                }
                            };
                        } else {
                            checkExists[scopeAction] = true;
                        }
                    } else {
                        const newRule: PlatformaticRule = {
                            role: roleName,
                            entity,
                        };

                        if (opts.checks) {
                            newRule[scopeAction] = {
                                checks: {
                                    userId: userKey
                                }
                            };
                        } else {
                            newRule[scopeAction] = true;
                        }

                        if (opts.defaults) {
                            newRule.defaults = {
                                userId: userKey
                            };
                        }

                        rules.push(newRule);
                    }
                }
            }

            const logRules = rules.reduce((prev, curr) => {
                (prev[curr['role']] ??= []).push(curr);
                return prev;
            }, {})

            for (const key in logRules) {
                app.log.info(`Rules set for role ${key}`);

                for (const element of logRules[key]) {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { entity, entities, role, ...other } = element;
                    app.log.info(`\t${entity ?? entities.join(',')}: ${JSON.stringify(other)}`);
                }
            }

            const missingEntities = Object.keys(app.platformatic.entities).filter((e) => !rules.map((r) => r.entity).includes(e));

            if (missingEntities.length) {
                app.log.warn(`Missing rules for entities: ${missingEntities.join(', ')}`);
            }

            app.log.debug('LogTo calculated rules');
            app.log.debug(rules);
            return rules;
        }

        const logToRules = await composeLogToRules();

        app.platformaticLogTo.rules = logToRules;

        // TODO validate that there is at most a rule for a given role
        const entityRules = {};
        for (let i = 0; i < logToRules.length; i++) {
            const rule = logToRules[i]

            let ruleEntities = null
            if (rule.entity) {
                ruleEntities = [rule.entity]
            } else if (rule.entities) {
                ruleEntities = [...rule.entities]
            } else {
                throw new Error(`Missing entity in authorization rule ${i}`)
            }

            for (const ruleEntity of ruleEntities) {
                const newRule = { ...rule, entity: ruleEntity, entities: undefined }
                if (!app.platformatic.entities[newRule.entity]) {
                    throw new Error(`Unknown entity '${ruleEntity}' in authorization rule ${i}`)
                }

                if (!entityRules[ruleEntity]) {
                    entityRules[ruleEntity] = []
                }
                entityRules[ruleEntity].push(newRule)
            }
        }

        for (const entityKey of Object.keys(app.platformatic.entities)) {
            const rules = entityRules[entityKey] || []
            const type = app.platformatic.entities[entityKey]

            // We have subscriptions!
            let userPropToFillForPublish
            const topicsWithoutChecks = false

            if (userPropToFillForPublish && topicsWithoutChecks) {
                throw new Error(`Subscription for entity "${entityKey}" have conflictling rules across roles`)
            }

            // MUST set this after doing the security checks on the subscriptions
            if (adminSecret) {
                rules.push({
                    role: PLT_ADMIN_ROLE,
                    find: true,
                    save: true,
                    delete: true,
                    updateMany: true
                })
            }

            // If we have `fields` in save rules, we need to check if all the not-nullable
            // fields are specified
            checkSaveMandatoryFieldsInRules(type, rules)

            function useOriginal(ctx: PlatformaticContext) {
                return !ctx
            }

            app.platformatic.addEntityHooks(entityKey, {
                async find(originalFind, { where, ctx, fields, ...restOpts } = {}) {
                    if (useOriginal(ctx)) {
                        return originalFind({ ...restOpts, where, ctx, fields })
                    }
                    const request = getRequestFromContext(ctx)
                    const rule = await findRuleForRequestUser(ctx, rules, roleKey, anonymousRole, isRolePath)
                    checkFieldsFromRule(rule.find, fields || Object.keys(app.platformatic.entities[entityKey].fields))
                    where = await fromRuleToWhere(ctx, rule.find, where, request.user)

                    return originalFind({ ...restOpts, where, ctx, fields })
                },
                async save(originalSave, { input, ctx, fields, ...restOpts }) {
                    if (useOriginal(ctx)) {
                        return originalSave({ ctx, input, fields, ...restOpts })
                    }
                    const request = getRequestFromContext(ctx)
                    const rule = await findRuleForRequestUser(ctx, rules, roleKey, anonymousRole, isRolePath)

                    if (!rule.save) {
                        throw new Unauthorized()
                    }
                    checkFieldsFromRule(rule.save, fields)
                    checkInputFromRuleFields(rule.save, input)

                    if (rule.defaults) {
                        for (const key of Object.keys(rule.defaults)) {
                            const defaults = rule.defaults[key]
                            if (typeof defaults === 'function') {
                                input[key] = await defaults({ user: request.user, ctx, input })
                            } else {
                                input[key] = request.user[defaults]
                            }
                        }
                    }

                    const hasAllPrimaryKeys = input[type.primaryKey] !== undefined;
                    const whereConditions = {}
                    whereConditions[type.primaryKey] = { eq: input[type.primaryKey] }

                    if (hasAllPrimaryKeys) {
                        const where = await fromRuleToWhere(ctx, rule.save, whereConditions, request.user)

                        const found = await type.find({
                            where,
                            ctx,
                            fields,
                        })

                        if (found.length === 0) {
                            throw new Unauthorized()
                        }

                        return originalSave({ input, ctx, fields, ...restOpts })
                    }

                    return originalSave({ input, ctx, fields, ...restOpts })
                },

                async insert(originalInsert, { inputs, ctx, fields, ...restOpts }) {
                    if (useOriginal(ctx)) {
                        return originalInsert({ inputs, ctx, fields, ...restOpts })
                    }
                    const request = getRequestFromContext(ctx)
                    const rule = await findRuleForRequestUser(ctx, rules, roleKey, anonymousRole, isRolePath)

                    if (!rule.save) {
                        throw new Unauthorized()
                    }

                    checkFieldsFromRule(rule.save, fields)
                    checkInputFromRuleFields(rule.save, inputs)

                    /* istanbul ignore else */
                    if (rule.defaults) {
                        for (const input of inputs) {
                            for (const key of Object.keys(rule.defaults)) {
                                const defaults = rule.defaults[key]
                                if (typeof defaults === 'function') {
                                    input[key] = await defaults({ user: request.user, ctx, input })
                                } else {
                                    input[key] = request.user[defaults]
                                }
                            }
                        }
                    }

                    return originalInsert({ inputs, ctx, fields, ...restOpts })
                },

                async delete(originalDelete, { where, ctx, fields, ...restOpts }) {
                    if (useOriginal(ctx)) {
                        return originalDelete({ where, ctx, fields, ...restOpts })
                    }
                    const request = getRequestFromContext(ctx)
                    const rule = await findRuleForRequestUser(ctx, rules, roleKey, anonymousRole, isRolePath)

                    where = await fromRuleToWhere(ctx, rule.delete, where, request.user)

                    return originalDelete({ where, ctx, fields, ...restOpts })
                },

                async updateMany(originalUpdateMany, { where, ctx, fields, ...restOpts }) {
                    if (useOriginal(ctx)) {
                        return originalUpdateMany({ ...restOpts, where, ctx, fields })
                    }
                    const request = getRequestFromContext(ctx)
                    const rule = await findRuleForRequestUser(ctx, rules, roleKey, anonymousRole, isRolePath)

                    where = await fromRuleToWhere(ctx, rule.updateMany, where, request.user)

                    return originalUpdateMany({ ...restOpts, where, ctx, fields })
                },
            })
        }
    }

    async function scopeBasedAuth() {
        for (const entityKey of Object.keys(app.platformatic.entities)) {
            // const type = app.platformatic.entities[entityKey]

            // We have subscriptions!
            let userPropToFillForPublish
            const topicsWithoutChecks = false

            if (userPropToFillForPublish && topicsWithoutChecks) {
                throw new Error(`Subscription for entity "${entityKey}" have conflictling rules across roles`)
            }

            function useOriginal(ctx: PlatformaticContext) {
                return !ctx
            }

            app.platformatic.addEntityHooks(entityKey, {
                async find(originalFind, { where, ctx, fields, ...restOpts } = {}) {
                    if (useOriginal(ctx)) {
                        return originalFind({ ...restOpts, where, ctx, fields })
                    }
                    await findScopeForRequestUser(ctx, entityKey, 'find', scopesKey, anonymousRole, isRolePath)

                    // checkFieldsFromRule(scope.find, fields || Object.keys(app.platformatic.entities[entityKey].fields))
                    // where = await fromRuleToWhere(ctx, scope.find, where, request.user)

                    return originalFind({ ...restOpts, where, ctx, fields })
                },
                async save(originalSave, { input, ctx, fields, ...restOpts }) {
                    if (useOriginal(ctx)) {
                        return originalSave({ ctx, input, fields, ...restOpts })
                    }
                    await findScopeForRequestUser(ctx, entityKey, 'save', scopesKey, anonymousRole, isRolePath)

                    // checkFieldsFromRule(rule.save, fields)
                    // checkInputFromRuleFields(rule.save, input)

                    // if (rule.defaults) {
                    //     for (const key of Object.keys(rule.defaults)) {
                    //         const defaults = rule.defaults[key]
                    //         if (typeof defaults === 'function') {
                    //             input[key] = await defaults({ user: request.user, ctx, input })
                    //         } else {
                    //             input[key] = request.user[defaults]
                    //         }
                    //     }
                    // }

                    // const hasAllPrimaryKeys = input[type.primaryKey] !== undefined;
                    // const whereConditions = {}
                    // whereConditions[type.primaryKey] = { eq: input[type.primaryKey] }

                    // if (hasAllPrimaryKeys) {
                    //     const where = await fromRuleToWhere(ctx, rule.save, whereConditions, request.user)

                    //     const found = await type.find({
                    //         where,
                    //         ctx,
                    //         fields,
                    //     })

                    //     if (found.length === 0) {
                    //         throw new Unauthorized()
                    //     }

                    //     return originalSave({ input, ctx, fields, ...restOpts })
                    // }

                    return originalSave({ input, ctx, fields, ...restOpts })
                },

                async insert(originalInsert, { inputs, ctx, fields, ...restOpts }) {
                    if (useOriginal(ctx)) {
                        return originalInsert({ inputs, ctx, fields, ...restOpts })
                    }
                    await findScopeForRequestUser(ctx, entityKey, 'insert', scopesKey, anonymousRole, isRolePath)

                    // checkFieldsFromRule(rule.save, fields)
                    // checkInputFromRuleFields(rule.save, inputs)

                    /* istanbul ignore else */
                    // if (rule.defaults) {
                    //     for (const input of inputs) {
                    //         for (const key of Object.keys(rule.defaults)) {
                    //             const defaults = rule.defaults[key]
                    //             if (typeof defaults === 'function') {
                    //                 input[key] = await defaults({ user: request.user, ctx, input })
                    //             } else {
                    //                 input[key] = request.user[defaults]
                    //             }
                    //         }
                    //     }
                    // }

                    return originalInsert({ inputs, ctx, fields, ...restOpts })
                },

                async delete(originalDelete, { where, ctx, fields, ...restOpts }) {
                    if (useOriginal(ctx)) {
                        return originalDelete({ where, ctx, fields, ...restOpts })
                    }
                    await findScopeForRequestUser(ctx, entityKey, 'delete', scopesKey, anonymousRole, isRolePath)

                    // where = await fromRuleToWhere(ctx, rule.delete, where, request.user)

                    return originalDelete({ where, ctx, fields, ...restOpts })
                },

                async updateMany(originalUpdateMany, { where, ctx, fields, ...restOpts }) {
                    if (useOriginal(ctx)) {
                        return originalUpdateMany({ ...restOpts, where, ctx, fields })
                    }
                    await findScopeForRequestUser(ctx, entityKey, 'updateMany', scopesKey, anonymousRole, isRolePath)

                    // where = await fromRuleToWhere(ctx, rule.updateMany, where, request.user)

                    return originalUpdateMany({ ...restOpts, where, ctx, fields })
                },
            })
        }
    }

    app.addHook('onReady', async function () {
        if (opts.roleBasedAuth) {
            await roleBasedAuth();
        }

        if (opts.scopeBasedAuth) {
            await scopeBasedAuth();
        }
    })
}, { name: '@albirex/platformatic-logto' });

async function fromRuleToWhere(ctx: PlatformaticContext, rule, where, user) {
    if (!rule) {
        throw new Unauthorized()
    }
    const request = getRequestFromContext(ctx)
    /* istanbul ignore next */
    where = where || {}

    if (typeof rule === 'object') {
        const { checks } = rule

        /* istanbul ignore else */
        if (checks) {
            for (const key of Object.keys(checks)) {
                const clauses = checks[key]
                if (typeof clauses === 'string') {
                    // case: "userId": "X-PLATFORMATIC-USER-ID"
                    where[key] = {
                        eq: request.user[clauses],
                    }
                } else {
                    // case:
                    // userId: {
                    //   eq: 'X-PLATFORMATIC-USER-ID'
                    // }
                    for (const clauseKey of Object.keys(clauses)) {
                        const clause = clauses[clauseKey]
                        where[key] = {
                            [clauseKey]: request.user[clause],
                        }
                    }
                }
            }
        }
    } else if (typeof rule === 'function') {
        where = await rule({ user, ctx, where })
    }
    return where
}

export async function findRuleForRequestUser(ctx: PlatformaticContext, rules: PlatformaticRule[], roleKey: string, anonymousRole: string, isRolePath = false) {
    const request = getRequestFromContext(ctx)
    await request.setupDBAuthorizationUser()
    const roles = getRoles(request, roleKey, anonymousRole, isRolePath)
    const rule = findRule(rules, roles)
    if (!rule) {
        ctx.reply.request.log.warn({ roles, rules }, 'no rule for roles')
        throw new Unauthorized()
    }
    ctx.reply.request.log.trace({ roles, rule }, 'found rule')
    return rule
}

export async function findScopeForRequestUser(ctx: PlatformaticContext, entityKey: string, action: EntityActions, scopesKey: string, anonymousRole: string, isScopePath = false) {
    const request = getRequestFromContext(ctx)
    await request.setupDBAuthorizationUser()
    const scopes = getScopes(request, scopesKey, anonymousRole, isScopePath)
    const scope = scopes.find(s => {
        if (s === PLT_ADMIN_SCOPES) {
            return true;
        }

        switch (action) {
            case 'find':
                return s === `${action}:${entityKey}` || s === `read:${entityKey}`
            case 'save':
                return s === `${action}:${entityKey}` || s === `create:${entityKey}` || s === `update:${entityKey}`
            case 'updateMany':
                return s === `${action}:${entityKey}` || s === `update:${entityKey}`
            case 'insert':
                return s === `${action}:${entityKey}` || s === `create:${entityKey}`
            default:
                return s === `${action}:${entityKey}`
        }
    });

    if (!scope) {
        ctx.reply.request.log.warn('no scope found')
        throw new Unauthorized()
    }
    ctx.reply.request.log.trace({ scopes, scope }, 'found scope')
}

export function checkFieldsFromRule(rule, fields) {
    if (!rule) {
        throw new Unauthorized()
    }
    const { fields: fieldsFromRule } = rule
    /* istanbul ignore else */
    if (fieldsFromRule) {
        for (const field of fields) {
            if (!fieldsFromRule.includes(field)) {
                throw new UnauthorizedField(field)
            }
        }
    }
}

const validateInputs = (inputs, fieldsFromRule) => {
    for (const input of inputs) {
        const inputFields = Object.keys(input)
        for (const inputField of inputFields) {
            if (!fieldsFromRule.includes(inputField)) {
                throw new UnauthorizedField(inputField)
            }
        }
    }
}

function checkInputFromRuleFields(rule, inputs) {
    const { fields: fieldsFromRule } = rule
    /* istanbul ignore else */
    if (fieldsFromRule) {
        if (!Array.isArray(inputs)) {
            // save
            validateInputs([inputs], fieldsFromRule)
        } else {
            // insert
            validateInputs(inputs, fieldsFromRule)
        }
    }
}

function checkSaveMandatoryFieldsInRules(type: Entity, rules) {
    // List of not nullable, not PKs field to validate save/insert when allowed fields are specified on the rule
    const mandatoryFields =
        Object.values(type.fields)
            .filter(k => (!k.isNullable && !k.primaryKey))
            .map(({ camelcase }) => (camelcase))

    for (const rule of rules) {
        const { entity, save } = rule
        if (save && save.fields) {
            const fields = save.fields
            for (const mField of mandatoryFields) {
                if (!fields.includes(mField)) {
                    throw new MissingNotNullableError(mField, entity)
                }
            }
        }
    }
}

/**
 * Check the permissions version
 * @throws PermissionsOutdated if versions don't match
 */
async function checkPermissionsVersion(app: FastifyInstance, opts: PlatformaticLogtoAuthOptions, user = null) {

    if (!opts.enableTokenVersionCheck || !opts.redis || !app.redis || !user) {
        return;
    }

    const sessionVersionKey = opts.sessionVersionKey || 'version'
    const tokenVersion = user?.[sessionVersionKey];
    const userId = user?.sub;

    try {
        const redisKey = `permissions:version:${userId}`;
        const currentVersionStr = await app.redis.get(redisKey);
        const currentVersion = parseInt(currentVersionStr, 10);

        if (currentVersionStr === null) {
            await app.redis.set(redisKey, tokenVersion.toString());
            app.log.debug({ userId, version: tokenVersion }, 'Initialized permissions version in Redis');
            if (tokenVersion > 1) {
                app.log.warn({
                    userId,
                    tokenVersion,
                    currentVersion
                }, 'Permissions version mismatch detected');
                throw new PermissionsOutdated();
            }
            return;
        }

        // Compare versions
        if (currentVersion !== tokenVersion) {
            app.log.warn({
                userId,
                tokenVersion,
                currentVersion
            }, 'Permissions version mismatch detected');
            throw new PermissionsOutdated();
        }

        app.log.trace({ userId, version: tokenVersion }, 'Token version check passed');
    } catch (error) {
        if (error.name === 'FastifyError' && error.code === 'PLT_DB_AUTH_VERSION_OUTDATED') {
            throw error;
        }
        app.log.error({ err: error, userId }, 'Error checking token version');
    }
}

export default platformaticLogto;

declare module 'fastify' {
    interface FastifyInstance {
        platformaticLogTo: {
            opts: PlatformaticLogtoAuthOptions,
            rules?: PlatformaticRule[]
        }
    }
}