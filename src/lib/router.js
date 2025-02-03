import { eventHandler } from '../handlers/eventHandler.js'
import { httpHandler } from '../handlers/httpHandler.js'

export async function router(context) {
  const req = context.req || context
  if (req.headers && req.headers['x-appwrite-event']) {
    return await eventHandler(context)
  }
  return await httpHandler(context)
}
