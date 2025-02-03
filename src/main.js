// src/main.js
import { validateConfig } from './lib/config.js'
import { router } from './lib/router.js'

console.log('[MAIN] Function starting')

export default async function main(context) {
  console.log('[MAIN] Context received:', context)
  if (!validateConfig()) {
    console.error('[MAIN] Configuration error')
    return { status: 500, body: 'Configuration error' }
  }
  const result = await router(context)
  console.log('[MAIN] Function result:', result)
  return result
}
