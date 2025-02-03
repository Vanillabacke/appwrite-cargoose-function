// src/handlers/httpHandler.js
import { fork } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { config } from '../lib/config.js'
import {
  createMediaDocument,
  updateMediaDocument,
  deleteMediaDocument,
  findMediaDocumentByFileId
} from '../lib/database.js'
import { deleteFile as deleteOriginalFile, deleteConvertedFile } from '../lib/storage.js'

export async function httpHandler(context) {
  const req = context.req || context
  const method = (req.method || 'POST').toUpperCase()
  let payload = {}

  if (req.bodyJson && Object.keys(req.bodyJson).length > 0) {
    payload = req.bodyJson
  } else if (req.body && typeof req.body === 'object') {
    payload = req.body
  } else if (req.bodyText && typeof req.bodyText === 'string') {
    try { payload = JSON.parse(req.bodyText) } catch (err) { return { status: 400, body: 'Invalid JSON in bodyText' } }
  } else if (req.bodyRaw && typeof req.bodyRaw === 'string') {
    try { payload = JSON.parse(req.bodyRaw) } catch (err) { return { status: 400, body: 'Invalid JSON in bodyRaw' } }
  }
  
  if (method === 'POST') {
    const { fileId, formats, metaData } = payload
    if (!fileId || !formats || !Array.isArray(formats)) {
      return { status: 400, body: 'Missing parameters' }
    }
    let existingDoc = await findMediaDocumentByFileId(fileId)
    if (existingDoc) {
      let existingFormats = typeof existingDoc.formats === 'string'
        ? JSON.parse(existingDoc.formats)
        : existingDoc.formats
      existingFormats = existingFormats.map(item => {
        if (typeof item === 'string') {
          try {
            return JSON.parse(item)
          } catch (e) {
            console.error('[HTTP] Error parsing an existing format entry:', item, e)
            return null
          }
        }
        return item
      }).filter(item => item !== null)

      console.log('[HTTP] Existing formats (normalized):', existingFormats)

      const uniqueFormats = {}
      for (const fmt of existingFormats) {
        if (
          !uniqueFormats[fmt.format] ||
          (uniqueFormats[fmt.format].status !== 'complete' && fmt.status === 'complete')
        ) {
          uniqueFormats[fmt.format] = fmt
        }
      }
      const deduplicatedFormats = Object.values(uniqueFormats)
      console.log('[HTTP] Deduplicated formats:', deduplicatedFormats)

      const newFormats = formats
        .filter(f => !deduplicatedFormats.some(e => e.format === f))
        .map(f => {
          console.log('[HTTP] Adding new format:', f)
          return {
            format: f,
            resolution: '',
            status: 'queued',
            fileId: null,
            size: null,
            width: null,
            height: null,
            retryCount: 0,
            maxRetries: config.VIDEO.MAX_RETRIES,
            processingTime: null,
            errors: []
          }
        })

      const updatedFormats = deduplicatedFormats.concat(newFormats)
      console.log('[HTTP] Updated formats:', updatedFormats)

      await updateMediaDocument(existingDoc.$id, { formats: updatedFormats.map(m => JSON.stringify(m)) })
      const child = fork(
        new URL('../lib/backgroundProcess.js', import.meta.url).pathname,
        ['conversion', existingDoc.$id],
        { stdio: 'inherit' }
      )
      return { status: 200, body: JSON.stringify({ jobId: existingDoc.$id, document: existingDoc }) }
    } else {
      const jobId = uuidv4()
      const conversionMetadata = formats.map(f => {
        console.log('[HTTP] Initializing format:', f)
        return {
          format: f,
          resolution: '',
          status: 'queued',
          fileId: null,
          size: null,
          width: null,
          height: null,
          retryCount: 0,
          maxRetries: config.VIDEO.MAX_RETRIES,
          processingTime: null,
          errors: []
        }
      })
      const document = {
        fileId: fileId,
        bucketId: config.APPWRITE.STORAGE_BUCKET_ID,
        name: payload.name || '',
        mimeType: payload.mimeType || '',
        size: payload.size || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isImage: payload.isImage || false,
        isVideo: payload.isVideo || true,
        width: payload.width || null,
        height: payload.height || null,
        duration: payload.duration || null,
        ownerId: payload.ownerId || '',
        visibility: payload.visibility || 'private',
        sharedWith: payload.sharedWith || [],
        tags: payload.tags || [],
        description: payload.description || '',
        lastAccessedAt: new Date().toISOString(),
        deletedAt: null,
        hash: payload.hash || '',
        metaData: JSON.stringify({
            status: 'queued',
            progress: 0,
            step: 'Awaiting processing',
            message: 'Conversion job added to queue'
        }),
        formats: conversionMetadata.map(m => JSON.stringify(m))
      }
      const doc = await createMediaDocument(jobId, document)
      const child = fork(
        new URL('../lib/backgroundProcess.js', import.meta.url).pathname,
        ['conversion', jobId],
        { stdio: 'inherit' }
      )
      return { status: 200, body: JSON.stringify({ jobId, document: doc }) }
    }
  }

  if (method === 'DELETE') {
    const { fileId, formats } = payload
    if (!fileId) {
      return { status: 400, body: 'Missing fileId' }
    }
    let existingDoc = await findMediaDocumentByFileId(fileId)
    if (!existingDoc) {
      return { status: 404, body: 'Document not found' }
    }

    let existingFormats = typeof existingDoc.formats === 'string'
      ? JSON.parse(existingDoc.formats)
      : existingDoc.formats
    existingFormats = existingFormats.map(item =>
      typeof item === 'string' ? JSON.parse(item) : item
    )
    console.log('[HTTP][DELETE] Existing formats (as objects):', existingFormats)

    if (formats && Array.isArray(formats) && formats.length > 0) {
      const remainingFormats = []
      for (let fmt of existingFormats) {
        if (formats.includes(fmt.format)) {
          console.log('[HTTP][DELETE] Deleting format:', fmt.format)
          if (fmt.fileId) {
            try {
              await deleteConvertedFile(fmt.fileId)
              console.log('[HTTP][DELETE] Deleted:', fmt.fileId)
            } catch (e) {
              console.error('[HTTP][DELETE] Error deleting', fmt.fileId, e)
            }
          }
        } else {
          remainingFormats.push(fmt)
        }
      }
      console.log('[HTTP][DELETE] Remaining formats after filtering:', remainingFormats)
      await updateMediaDocument(existingDoc.$id, { 
        formats: remainingFormats.map(m => JSON.stringify(m)),
        metaData: JSON.stringify({ status: 'deleted' })
      })
      return { status: 200, body: JSON.stringify({ jobId: existingDoc.$id, removedFormats: formats }) }
    } else {
      console.log('[HTTP][DELETE] Deleting entire video and all formats')
      if (existingDoc.fileId) {
        try {
          await deleteOriginalFile(existingDoc.fileId)
          console.log('[HTTP][DELETE] Original file deleted:', existingDoc.fileId)
        } catch (e) {
          console.error('[HTTP][DELETE] Error deleting original file', e)
        }
      }
      for (let fmt of existingFormats) {
        if (fmt.fileId) {
          try {
            await deleteConvertedFile(fmt.fileId)
            console.log('[HTTP][DELETE] Deleted:', fmt.fileId)
          } catch (e) {
            console.error('[HTTP][DELETE] Error deleting', fmt.fileId, e)
          }
        }
      }
      await deleteMediaDocument(existingDoc.$id)
      return { status: 200, body: JSON.stringify({ jobId: existingDoc.$id, deleted: true }) }
    }
  }
  return { status: 405, body: 'Method not allowed' }
}
