'use strict'

export function getRequestFromContext (ctx) {
  if (ctx && !ctx.reply) {
    throw new Error('Missing reply in context. You should call this function with { ctx: { reply }}')
  }
  return ctx.reply.request
}

export function getRoles (request, roleKey, anonymousRole, isRolePath = false) {
  let output = []
  const user = request.user
  if (!user) {
    output.push(anonymousRole)
    return output
  }

  let rolesRaw
  if (isRolePath) {
    const roleKeys = roleKey.split('.')
    rolesRaw = user
    for (const key of roleKeys) {
      rolesRaw = rolesRaw[key]
    }
  } else {
    rolesRaw = user[roleKey]
  }

  if (typeof rolesRaw === 'string') {
    output = rolesRaw.split(',')
  } else if (Array.isArray(rolesRaw)) {
    output = rolesRaw
  }
  if (output.length === 0) {
    output.push(anonymousRole)
  }

  return output
}

export function getScopes(request, scopesKey, anonymousRole, isScopePath = false) {
  let output = []
  const user = request.user
  if (!user) {
    output.push(anonymousRole)
    return output
  }

  let scopesRaw
  if (isScopePath) {
    const roleKeys = scopesKey.split('.')
    scopesRaw = user
    for (const key of roleKeys) {
      scopesRaw = scopesRaw[key]
    }
  } else {
    scopesRaw = user[scopesKey]
  }

  if (typeof scopesRaw === 'string') {
    output = scopesRaw.split(' ')
  } else if (Array.isArray(scopesRaw)) {
    output = scopesRaw
  }
  if (output.length === 0) {
    output.push(anonymousRole)
  }

  return output
}
