import fp from 'fastify-plugin'
import leven from 'leven'
import fastifyUser from 'fastify-user'

import findRule from './utils/find-rule.js'
import { getRequestFromContext, getRoles } from './utils/utils.js'
import { Unauthorized, UnauthorizedField, MissingNotNullableError } from './utils/errors.js'
import fastifyLogto from '@albirex/fastify-logto';
import { FastifyInstance } from 'fastify'
import type { FastifyUserPluginOptions } from 'fastify-user';
import type { Entity, PlatformaticContext } from '@platformatic/sql-mapper'

const PLT_ADMIN_ROLE = 'platformatic-admin'

export type PlatformaticRule = {
    role: string;
    entity?: string;
    entities?: string[];
    defaults?: Record<string, string>;
    checks?: boolean;
    find?: boolean;
    save?: boolean;
    delete?: boolean;

};

export type PlatformaticLogtoAuthOptions = {
    logtoBaseUrl?: string;
    logtoAppId?: string;
    logtoAppSecret?: string;
    adminSecret?: string;
    rolePath?: string;
    roleKey?: string;
    userPath?: string;
    userKey?: string;
    anonymousRole?: string;
    allowAnonymous?: boolean;
    checks?: boolean;
    defaults?: boolean;
    jwtPlugin: FastifyUserPluginOptions
};

async function auth(app: FastifyInstance, opts: PlatformaticLogtoAuthOptions) {
    app.register(fastifyLogto, {
        endpoint: opts.logtoBaseUrl || 'https://auth.example.com',
        appId: opts.logtoAppId || 'your-app-id',
        appSecret: opts.logtoAppSecret || 'your-app-secret',
    });
    await app.register(fastifyUser.default, opts.jwtPlugin);

    const adminSecret = opts.adminSecret
    const roleKey = opts.rolePath || opts.roleKey || 'X-PLATFORMATIC-ROLE'
    const userKey = opts.userPath || opts.userKey || 'X-PLATFORMATIC-USER-ID'
    const isRolePath = !!opts.rolePath // if `true` the role is intepreted as path like `user.role`
    const anonymousRole = opts.anonymousRole || 'anonymous'

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
                const [scopeAction, entity] = scope.name.split(':');

                if (!app.platformatic.entities[entity]) {
                    const nearest = findNearestEntity(entity)
                    app.log.warn(`Unknown entity '${entity}' in authorization rule. Did you mean '${nearest.entity}'?`)
                    continue;
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

        app.log.debug('LogTo calculated rules');
        app.log.debug(rules);
        return rules;
    }

    app.decorateRequest('setupDBAuthorizationUser', setupUser)

    async function setupUser() {
        // if (!adminSecret) {
        await this.extractUser()
        // }

        let forceAdminRole = false
        if (adminSecret && this.headers['x-platformatic-admin-secret'] === adminSecret) {
            if (opts.jwtPlugin) {
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
        }

        if (forceAdminRole) {
            // We replace just the role in `request.user`, all the rest is untouched
            console.log(this.user);

            this.user = {
                // ...request.user,
                [roleKey]: PLT_ADMIN_ROLE,
            }
        }
    }

    function findNearestEntity(ruleEntity) {
        // There is an unknown entity. Let's find out the nearest one for a nice error message
        const entities = Object.keys(app.platformatic.entities)

        const nearest = entities.reduce((acc, entity) => {
            const distance = leven(ruleEntity, entity)
            if (distance < acc.distance) {
                acc.distance = distance
                acc.entity = entity
            }
            return acc
        }, { distance: Infinity, entity: null })
        return nearest
    }

    app.addHook('onReady', async function () {
        const rules = await composeLogToRules();

        // TODO validate that there is at most a rule for a given role
        const entityRules = {};
        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i]

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
                    const nearest = findNearestEntity(ruleEntity)
                    throw new Error(`Unknown entity '${ruleEntity}' in authorization rule ${i}. Did you mean '${nearest.entity}'?`)
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

            // mqtt
            // if (app.platformatic.mq) {
            //     for (const rule of rules) {
            //         const checks = rule.find?.checks
            //         if (typeof checks !== 'object') {
            //             topicsWithoutChecks = !!rule.find
            //             continue
            //         }
            //         const keys = Object.keys(checks)
            //         if (keys.length !== 1) {
            //             throw new Error(`Subscription requires that the role "${rule.role}" has only one check in the find rule for entity "${rule.entity}"`)
            //         }
            //         const key = keys[0]

            //         const val = typeof checks[key] === 'object' ? checks[key].eq : checks[key]
            //         if (userPropToFillForPublish && userPropToFillForPublish.val !== val) {
            //             throw new Error('Unable to configure subscriptions and authorization due to multiple check clauses in find')
            //         }
            //         userPropToFillForPublish = { key, val }
            //     }
            // }

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
                })
            }

            // If we have `fields` in save rules, we need to check if all the not-nullable
            // fields are specified
            checkSaveMandatoryFieldsInRules(type, rules)

            // function useOriginal(skipAuth: boolean, ctx: PlatformaticContext) {
            //     if (skipAuth === false && !ctx) {
            //         throw new Error('Cannot set skipAuth to `false` without ctx')
            //     }

            //     return skipAuth || !ctx
            // }

            app.platformatic.addEntityHooks(entityKey, {
                async find(originalFind, { where, ctx, fields, ...restOpts } = {}) {
                    // if (useOriginal(skipAuth, ctx)) {
                    //     return originalFind({ ...restOpts, where, ctx, fields })
                    // }
                    const request = getRequestFromContext(ctx)
                    const rule = await findRuleForRequestUser(ctx, rules, roleKey, anonymousRole, isRolePath)
                    checkFieldsFromRule(rule.find, fields || Object.keys(app.platformatic.entities[entityKey].fields))
                    where = await fromRuleToWhere(ctx, rule.find, where, request.user)

                    return originalFind({ ...restOpts, where, ctx, fields })
                },
                async save(originalSave, { input, ctx, fields, ...restOpts }) {
                    // if (useOriginal(skipAuth, ctx)) {
                    //     return originalSave({ ctx, input, fields, ...restOpts })
                    // }
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
                    // if (useOriginal(skipAuth, ctx)) {
                    //     return originalInsert({ inputs, ctx, fields, ...restOpts })
                    // }
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
                    // if (useOriginal(skipAuth, ctx)) {
                    //     return originalDelete({ where, ctx, fields, ...restOpts })
                    // }
                    const request = getRequestFromContext(ctx)
                    const rule = await findRuleForRequestUser(ctx, rules, roleKey, anonymousRole, isRolePath)

                    where = await fromRuleToWhere(ctx, rule.delete, where, request.user)

                    return originalDelete({ where, ctx, fields, ...restOpts })
                },

                async updateMany(originalUpdateMany, { where, ctx, fields, ...restOpts }) {
                    // if (useOriginal(skipAuth, ctx)) {
                    //     return originalUpdateMany({ ...restOpts, where, ctx, fields })
                    // }
                    const request = getRequestFromContext(ctx)
                    const rule = await findRuleForRequestUser(ctx, rules, roleKey, anonymousRole, isRolePath)

                    where = await fromRuleToWhere(ctx, rule.updateMany, where, request.user)

                    return originalUpdateMany({ ...restOpts, where, ctx, fields })
                },
            })
        }
    })
}

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

async function findRuleForRequestUser(ctx: PlatformaticContext, rules: PlatformaticRule[], roleKey: string, anonymousRole: string, isRolePath = false) {
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

function checkFieldsFromRule(rule, fields) {
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

export default fp(auth)
