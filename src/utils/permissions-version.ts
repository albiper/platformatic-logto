'use strict'

import type { FastifyInstance } from 'fastify'

/**
 * Increment the permissions version
 * @param app - Fastify instance with Redis client and Logto
 * @param userId - User ID
 * @returns New version number
 */
export async function incrementPermissionsVersion(app: FastifyInstance, userId: string): Promise<number> {
    if (!app.logto) {
        throw new Error('Logto client not available')
    }

    const userResp = await app.logto.callAPI(`/api/users/${userId}`, 'GET')
    const userData = await userResp.json()
    const existingCustomData = userData.customData || {}
    const currentVersion = existingCustomData.sessionVersion || 0
    const newVersion = currentVersion + 1

    await app.logto.callAPI(`/api/users/${userId}`, 'PATCH', JSON.stringify({ customData: { ...existingCustomData, sessionVersion: newVersion } }))

    if (app.redis) {
        const redisKey = `permissions:version:${userId}`
        await app.redis.set(redisKey, newVersion.toString())
    }

    return newVersion
}

/**
 * Delete the permissions version for a user
 * @param app - Fastify instance with Redis client
 * @param userId - User ID
 */
export async function deletePermissionsVersion(app: FastifyInstance, userId: string): Promise<void> {
    if (!app.redis) {
        throw new Error('Redis client not available')
    }

    const redisKey = `permissions:version:${userId}`
    await app.redis.del(redisKey)
}

