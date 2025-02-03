import { createMediaDocument, deleteMediaDocument } from '../lib/database.js'

export async function eventHandler(context) {
  const req = context.req || context
  const event = req.headers['x-appwrite-event']
  const data = req.bodyJson ? req.bodyJson : JSON.parse(req.bodyRaw || '{}')
  if (event && event.includes('.create')) {
    const doc = await createMediaDocument({
      id: data.jobId,
      originalFileId: data.fileId,
      fileName: data.fileName || '',
      metaData: JSON.stringify(data.metaData || {}),
      convertedFormats: JSON.stringify([]),
      conversionQueue: JSON.stringify([{ jobId: data.jobId, status: 'created', progress: 0 }])
    })
    return { status: 200, body: JSON.stringify(doc) }
  }
  if (event && event.includes('.delete')) {
    const result = await deleteMediaDocument(data.id)
    return { status: 200, body: JSON.stringify(result) }
  }
  return { status: 400, body: 'Unsupported event' }
}
