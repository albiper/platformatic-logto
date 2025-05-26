'use strict'

import { PlatformaticRule } from '../index.js'

function findRule(rules: PlatformaticRule[], roles: string[]) {
  let found = null
  for (const rule of rules) {
    for (const role of roles) {
      if (rule.role === role) {
        found = rule
        break
      }
    }
    if (found) {
      break
    }
  }
  return found
}

export default findRule
