## main.js

```javascript
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

```

## handlers\eventHandler.js

```javascript
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

```

## handlers\httpHandler.js

```javascript
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

```

## lib\backgroundProcess.js

```javascript
import { conversionJob } from './conversionJob.js'
console.log('[BG] Background process started, argv:', process.argv)
const [jobType, jobId] = process.argv.slice(2)
console.log('[BG] Parsed parameters:', { jobType, jobId })
if (jobType === 'conversion' && jobId) {
  conversionJob(jobId)
    .then(() => {
      console.log('[BG] Conversion job completed successfully for jobId:', jobId)
      process.exit(0)
    })
    .catch((err) => {
      console.error('[BG] Conversion job failed for jobId:', jobId, err)
      process.exit(1)
    })
} else {
  console.error('[BG] Invalid job parameters:', process.argv.slice(2))
  process.exit(1)
}
```

## lib\config.js

```javascript
export const config = {
    APPWRITE: {
      ENDPOINT: process.env.APPWRITE_ENDPOINT,
      PROJECT_ID: process.env.APPWRITE_FUNCTION_PROJECT_ID,
      API_KEY: process.env.APPWRITE_FUNCTION_API_KEY,
      STORAGE_DB_ID: process.env.APPWRITE_STORAGE_DB_ID,
      STORAGE_COLLECTION_ID: process.env.APPWRITE_STORAGE_COLLECTION_ID,
      STORAGE_BUCKET_ID: process.env.APPWRITE_STORAGE_BUCKET_ID,
      CONVERSION_BUCKET_ID: process.env.APPWRITE_CONVERSION_STORAGE_BUCKET_ID
    },
    VIDEO: {
      TEMP_DIR: process.env.TEMP_DIR || 'tmp',
      OUTPUT_DIR: process.env.OUTPUT_DIR || 'tmp',
      FORMATS: {
        '8K': 7680,
        '6K': 6144,
        '5K': 5120,
        '4K': 3840,
        '2K': 2048,
        'UHD': 3840,
        '1080p': 1920,
        '720p': 1280,
        '480p': 854,
        '360p': 640,
        '240p': 426 
      },
      
      MAX_RETRIES: Number(process.env.MAX_RETRIES) || 3,
      RETRY_DELAY_MS: Number(process.env.RETRY_DELAY_MS) || 5000
    }
  }
  
  export function validateConfig() {
    return (
      config.APPWRITE.ENDPOINT &&
      config.APPWRITE.API_KEY &&
      config.APPWRITE.PROJECT_ID &&
      config.APPWRITE.STORAGE_DB_ID &&
      config.APPWRITE.STORAGE_COLLECTION_ID &&
      config.APPWRITE.STORAGE_BUCKET_ID &&
      config.APPWRITE.CONVERSION_BUCKET_ID &&
      config.VIDEO.TEMP_DIR &&
      config.VIDEO.OUTPUT_DIR
    )
  }
  
```

## lib\conversionJob.js

```javascript
// src/lib/conversionJob.js
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { getMediaDocument, updateMediaDocument } from './database.js'
import { downloadFile, uploadFile, getFileMetadata } from './storage.js'
import { config } from './config.js'
import { processVideoForFormat } from './videoProcessor.js'
import { getVideoDimensions } from './videoProcessor.js'

// Parses the stored formats string (or array) into objects.
function parseFormats(formatsValue) {
  if (!Array.isArray(formatsValue)) {
    try {
      formatsValue = JSON.parse(formatsValue)
    } catch (err) {
      return []
    }
  }
  return formatsValue
    .map(item => (typeof item === 'string' ? JSON.parse(item) : item))
    .filter(item => item !== null)
}

// Serializes the formats array (each as a JSON string)
function serializeFormats(formatsArray) {
  return formatsArray.map(item => JSON.stringify(item))
}

// Update overall metaData in the document.
// Extra fields (such as jobStartTimestamp) may be passed via extra.
async function updateOverallMetaData(jobId, formatsArray, forcedStatus = null, extra = {}) {
  const total = formatsArray.reduce((sum, fmt) => sum + (fmt.progress || 0), 0)
  const overallProgress = Math.floor(total / formatsArray.length)
  const overallStatus =
    forcedStatus ||
    (formatsArray.every(fmt => fmt.status === 'complete' || fmt.status === 'skipped') ? 'complete' : 'processing')
  const metaData = {
    status: overallStatus,
    progress: overallProgress,
    step: overallStatus === 'complete'
      ? 'All formats processed'
      : `Processing (${overallProgress}%)`,
    message: overallStatus === 'complete' ? 'Conversion finished successfully' : '',
    ...extra,
    jobLastUpdated: new Date().toISOString()
  }
  await updateMediaDocument(jobId, { metaData: JSON.stringify(metaData) })
}

export async function conversionJob(jobId) {
  let doc = await getMediaDocument(jobId)

  // If the document's name is empty, set it to the original file's name or a fallback.
  if (!doc.name || doc.name.trim() === "") {
    const newName = doc.fileName && doc.fileName.trim() !== "" ? doc.fileName : `File ${jobId}`
    await updateMediaDocument(jobId, { name: newName })
  }

  // Set metaData to "preparing" before download.
  await updateMediaDocument(jobId, {
    metaData: JSON.stringify({
      status: 'preparing',
      progress: 0,
      step: 'Downloading original file',
      message: 'Conversion job added to queue'
    })
  })

  // Download the original file with progress updates.
  const tempDir = config.VIDEO.TEMP_DIR
  await fs.mkdir(tempDir, { recursive: true })
  const originalFilePath = path.join(tempDir, `${jobId}.mp4`)
  const fileBuffer = await downloadFile(doc.fileId, async (progress) => {
    await updateMediaDocument(jobId, {
      metaData: JSON.stringify({
        status: 'preparing',
        progress,
        step: 'Downloading original file',
        message: `${progress}% downloaded`
      })
    })
  })
  await fs.writeFile(originalFilePath, fileBuffer)

  // Get the original file's dimensions.
  const dimensions = await getVideoDimensions(originalFilePath)
  const origWidth = dimensions.width
  console.log(`[CONVERSION] Source width: ${origWidth}px`)

  let formatsArray = parseFormats(doc.formats)
  await updateOverallMetaData(jobId, formatsArray)

  // Process each requested format.
  for (let i = 0; i < formatsArray.length; i++) {
    const fmt = formatsArray[i]
    if (fmt.status === 'complete') {
      console.log(`[CONVERSION] Skipping ${fmt.format} (already complete)`)
      continue
    }
    try {
      // Record conversion start timestamp.
      fmt.conversionStart = new Date().toISOString()
      fmt.status = 'processing'
      fmt.progress = 0
      fmt.retryCount = 0
      await updateMediaDocument(jobId, { formats: serializeFormats(formatsArray) })
      await updateOverallMetaData(jobId, formatsArray)

      const targetWidth = config.VIDEO.FORMATS[fmt.format] || config.VIDEO.FORMATS.HD
      fmt.targetWidth = targetWidth // record conversion parameter
      if (targetWidth > origWidth) {
        console.log(`[CONVERSION] Skipping ${fmt.format} (target ${targetWidth}px exceeds source ${origWidth}px)`)
        fmt.status = 'skipped'
        fmt.errors = fmt.errors || []
        fmt.errors.push({
          message: `Source width ${origWidth}px < target ${targetWidth}px`,
          code: 'UPSCALE_NOT_ALLOWED'
        })
        await updateMediaDocument(jobId, { formats: serializeFormats(formatsArray) })
        await updateOverallMetaData(jobId, formatsArray)
        continue
      }
      const processStart = Date.now()
      const convertedFilePath = await processVideoForFormat(
        originalFilePath,
        jobId,
        fmt.format,
        async (progress) => {
          fmt.progress = progress
          fmt.status = progress < 100 ? 'processing' : 'complete'
          await updateMediaDocument(jobId, { formats: serializeFormats(formatsArray) })
          await updateOverallMetaData(jobId, formatsArray)
        }
      )
      // Define consistent output filename.
      const finalOutputPath = path.join(config.VIDEO.OUTPUT_DIR, `${fmt.format}_${jobId}.mp4`)
      const uploadResult = await uploadFile(convertedFilePath, `${fmt.format}_${jobId}.mp4`)
      fmt.status = 'complete'
      fmt.fileId = uploadResult.$id
      fmt.processingTime = (Date.now() - processStart) / 1000

      // Instead of reading local file stats (if the file was removed post-upload),
      // fetch metadata from the storage service.
      try {
        const fileMeta = await getFileMetadata(fmt.fileId)
        // Assume fileMeta contains size, width, and height.
        fmt.size = fileMeta.size || null
        fmt.width = fileMeta.width || null
        fmt.height = fileMeta.height || null
      } catch (metaErr) {
        console.error(`[CONVERSION] Failed to fetch metadata for format ${fmt.format}: ${metaErr.message}`)
      }
      fmt.conversionEnd = new Date().toISOString()
      await updateMediaDocument(jobId, { formats: serializeFormats(formatsArray) })
      await updateOverallMetaData(jobId, formatsArray)
    } catch (formatError) {
      console.error(`[CONVERSION] Error processing format ${fmt.format}: ${formatError.message}`)
      fmt.status = 'failed'
      fmt.errors = fmt.errors || []
      fmt.errors.push({
        timestamp: new Date().toISOString(),
        message: formatError.message,
        code: formatError.code || 'CONVERSION_ERROR'
      })
      await updateMediaDocument(jobId, { formats: serializeFormats(formatsArray) })
      await updateOverallMetaData(jobId, formatsArray)
    }
  }
  await updateMediaDocument(jobId, {
    metaData: JSON.stringify({
      status: 'complete',
      progress: 100,
      step: 'All formats processed',
      message: 'Conversion finished successfully',
      jobEndTimestamp: new Date().toISOString()
    })
  })
  await updateOverallMetaData(jobId, formatsArray, 'complete')
}

```

## lib\database.js

```javascript
import { Client, Databases, Query } from 'node-appwrite'
import { config } from './config.js'

const client = new Client()
  .setEndpoint(config.APPWRITE.ENDPOINT)
  .setProject(config.APPWRITE.PROJECT_ID)
  .setKey(config.APPWRITE.API_KEY)

const databases = new Databases(client)

export async function createMediaDocument(docId, data) {
  return await databases.createDocument(
    config.APPWRITE.STORAGE_DB_ID,
    config.APPWRITE.STORAGE_COLLECTION_ID,
    docId,
    data
  )
}

export async function getMediaDocument(docId) {
  return await databases.getDocument(
    config.APPWRITE.STORAGE_DB_ID,
    config.APPWRITE.STORAGE_COLLECTION_ID,
    docId
  )
}

export async function updateMediaDocument(docId, data) {
  return await databases.updateDocument(
    config.APPWRITE.STORAGE_DB_ID,
    config.APPWRITE.STORAGE_COLLECTION_ID,
    docId,
    data
  )
}

export async function findMediaDocumentByFileId(fileId) {
    const result = await databases.listDocuments(
      config.APPWRITE.STORAGE_DB_ID,
      config.APPWRITE.STORAGE_COLLECTION_ID,
      [Query.equal("fileId", fileId)]
    )
    return result.documents.length > 0 ? result.documents[0] : null
}

export async function deleteMediaDocument(docId) {
  return await databases.deleteDocument(
    config.APPWRITE.STORAGE_DB_ID,
    config.APPWRITE.STORAGE_COLLECTION_ID,
    docId
  )
}



```

## lib\router.js

```javascript
import { eventHandler } from '../handlers/eventHandler.js'
import { httpHandler } from '../handlers/httpHandler.js'

export async function router(context) {
  const req = context.req || context
  if (req.headers && req.headers['x-appwrite-event']) {
    return await eventHandler(context)
  }
  return await httpHandler(context)
}

```

## lib\storage.js

```javascript
// src/lib/storage.js
import { Client, Storage } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { config } from './config.js'

const client = new Client()
  .setEndpoint(config.APPWRITE.ENDPOINT)
  .setProject(config.APPWRITE.PROJECT_ID)
  .setKey(config.APPWRITE.API_KEY)
const storage = new Storage(client)


export async function downloadFile(fileId) {
  console.log('[STORAGE] Downloading file with id:', fileId)
  try {
    const result = await storage.getFileDownload(config.APPWRITE.STORAGE_BUCKET_ID, fileId)
    console.log('[STORAGE] Raw download result:', result)
    if (Buffer.isBuffer(result)) {
      console.log('[STORAGE] Result is already a Buffer, size:', result.length)
      return result
    }
    if (result instanceof ArrayBuffer) {
      const buffer = Buffer.from(result)
      console.log('[STORAGE] Converted ArrayBuffer to Buffer, size:', buffer.length)
      return buffer
    }
    if (result && typeof result.on === 'function') {
      const chunks = []
      await new Promise((resolve, reject) => {
        result.on('data', (chunk) => chunks.push(chunk))
        result.on('end', resolve)
        result.on('error', reject)
      })
      const buffer = Buffer.concat(chunks)
      console.log('[STORAGE] Converted stream to Buffer, size:', buffer.length)
      return buffer
    }
    if (result && result.body) {
      const buffer = Buffer.from(result.body)
      console.log('[STORAGE] Converted result.body to Buffer, size:', buffer.length)
      return buffer
    }
    if (typeof result === 'string') {
      const buffer = Buffer.from(result)
      console.log('[STORAGE] Converted string result to Buffer, size:', buffer.length)
      return buffer
    }
    console.log('[STORAGE] Unexpected result type:', result)
    throw new Error('downloadFile returned empty buffer')
  } catch (err) {
    console.error('[STORAGE] Error downloading file with id:', fileId, err)
    throw err
  }
}

export async function uploadFile(filePath, fileName) {
  return await storage.createFile(
    config.APPWRITE.CONVERSION_BUCKET_ID,
    'unique()',
    InputFile.fromPath(filePath, fileName)
  )
}

export async function deleteFile(fileId) {
  return await storage.deleteFile(config.APPWRITE.STORAGE_BUCKET_ID, fileId)
}

export async function deleteConvertedFile(fileId) {
    return await storage.deleteFile(config.APPWRITE.CONVERSION_BUCKET_ID, fileId)
}


export async function getFileMetadata(fileId) {
    return await storage.getFile(config.APPWRITE.CONVERSION_BUCKET_ID, fileId)
}
```

## lib\videoProcessor.js

```javascript
// src/lib/videoProcessor.js
import fsPromises from 'fs/promises'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { promisify } from 'util'
import { execFile } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { path as ffprobePath } from 'ffprobe-static'
import { config } from './config.js'
import { setTimeout } from 'timers/promises'
import { constants } from 'fs/promises'
const execFileAsync = promisify(execFile)

function vpLog(message) {
  const msg = `[VP] ${new Date().toISOString()} ${message}\n`
  try {
    fs.appendFileSync('video_processor.log', msg)
  } catch (err) {
    console.error('[VP] Failed to write to log file:', err)
  }
  console.log(msg)
}

export async function getVideoDimensions(filePath) {
  vpLog(`Running ffprobe on file: ${filePath}`)
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration',
    '-of', 'json',
    filePath
  ])
  const probeData = JSON.parse(stdout)
  const stream = probeData.streams[0]
  vpLog(`ffprobe returned: ${JSON.stringify(stream)}`)
  return { width: stream.width, height: stream.height, duration: stream.duration }
}

// Added logging for both stdout and stderr, so you can see what ffmpeg outputs.
// Also logs the exact command that is being run.
function runProcessWithProgress(command, args, log, updateProgress, totalDurationMs, timeout = 300000) {
  return new Promise((resolve, reject) => {
    // Force progress output from ffmpeg
    // args.push('-progress', 'pipe:2')
    // args.push('-progress', 'pipe:1')
    args.push('-progress', 'pipe:1', '-loglevel', 'quiet')
    log(`[DEBUG] Running ffmpeg command: ${command} ${args.join(' ')}`)
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let lastProgressTime = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - lastProgressTime > timeout) {
        proc.kill()
        clearInterval(timer)
        log('[ERROR] Process timed out with no progress update')
        reject(new Error('Process timed out'))
      }
    }, 1000)
    
    // Log both stdout and stderr for maximum insight.
    proc.stdout.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) {
        log(`[FFMPEG STDOUT] ${msg}`)
      }
    })


    proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const parts = trimmed.split('=')
          if (parts[0] === 'out_time_ms' && totalDurationMs) {
            const outTimeMs = parseInt(parts[1]) / 1000
            if (outTimeMs) {
              const progress = Math.floor((outTimeMs / totalDurationMs) * 100)
              updateProgress(progress)
            }
          }
          if (parts[0] === 'progress' && parts[1] === 'end') {
            updateProgress(100)
          }
        }
        lastProgressTime = Date.now()
    })
    
    proc.stderr.on('data', (data) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const parts = trimmed.split('=')
        if (parts[0] === 'out_time_ms' && totalDurationMs) {
            const outTimeMs = parseInt(parts[1]) / 1000
            if (outTimeMs) {
            const progress = Math.floor((outTimeMs / totalDurationMs) * 100)
            updateProgress(progress)
            }
        }
        if (parts[0] === 'progress' && parts[1] === 'end') {
            updateProgress(100)
        }
        }
        lastProgressTime = Date.now()
    })
    
    proc.on('error', (err) => {
      clearInterval(timer)
      log(`[ERROR] Process error: ${err.message}`)
      reject(err)
    })
    
    proc.on('close', (code) => {
      clearInterval(timer)
      if (code === 0) {
        log('[DEBUG] FFmpeg process completed successfully')
        updateProgress(100)
        resolve()
      } else {
        log(`[ERROR] FFmpeg process failed with code ${code}`)
        reject(new Error(`Process exited with code ${code}`))
      }
    })
  })
}

async function ensureDirectoryExists(filePath) {
  const dir = path.dirname(filePath)
  vpLog(`Ensuring directory exists: ${dir}`)
  await fsPromises.mkdir(dir, { recursive: true })
  vpLog(`Directory exists or created: ${dir}`)
}

async function scaleVideo(inputPath, outputPath, width, log, updateProgress) {
    vpLog('Starting scaleVideo')
    await fsPromises.access(inputPath, constants.R_OK)
    vpLog(`Input file accessible: ${inputPath}`)
    await ensureDirectoryExists(outputPath)
    const targetWidth = Math.max(2, width % 2 === 0 ? width : width - 1)
    const scaleFilter = `scale=${targetWidth}:-2:force_divisible_by=2`
    log(`[PROCESS] Scaling video to ${targetWidth}px width`)
    const dimensions = await getVideoDimensions(inputPath)
    const totalDurationMs = Math.floor(parseFloat(dimensions.duration) * 1000)
    await runProcessWithProgress(ffmpegPath, [
      '-hide_banner',
      '-i', inputPath,
      '-vf', scaleFilter,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-strict', 'experimental',
      '-f', 'mp4',
      '-y', outputPath
    ], log, updateProgress, totalDurationMs)
    vpLog(`scaleVideo completed for: ${inputPath}`)
  }
  
  export async function processVideoWithRetries(inputPath, outputPath, width, log, updateProgress) {
    let retries = 0
    const tempOutputPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`
    vpLog(`Temporary output path: ${tempOutputPath}`)
    while (retries < config.VIDEO.MAX_RETRIES) {
      try {
        log(`[ATTEMPT] ${retries + 1}/${config.VIDEO.MAX_RETRIES}`)
        await scaleVideo(inputPath, tempOutputPath, width, log, p => updateProgress(Math.floor(p * 0.95)))
        const stats = await fsPromises.stat(tempOutputPath)
        if (stats.size === 0) throw new Error('Output file is empty')
        await fsPromises.rename(tempOutputPath, outputPath)
        vpLog(`Renamed temp file to final output: ${outputPath}`)
        updateProgress(100)
        return
      } catch (err) {
        retries++
        log(`[RETRY] Attempt ${retries} failed: ${err.message}`)
        await Promise.all([
          fsPromises.unlink(tempOutputPath).catch(() => {}),
          fsPromises.unlink(outputPath).catch(() => {})
        ])
        if (retries >= config.VIDEO.MAX_RETRIES) {
          vpLog('[ERROR] Max retries reached')
          throw new Error(`[FATAL] Failed after ${retries} attempts: ${err.message}`)
        }
        vpLog(`Waiting for ${config.VIDEO.RETRY_DELAY_MS * retries} ms before retry`)
        await setTimeout(config.VIDEO.RETRY_DELAY_MS * retries)
      }
    }
  }
  
  export async function processVideoForFormat(inputFilePath, jobId, format, progressCallback = (p) => {}) {
    vpLog(`Starting processVideoForFormat for jobId: ${jobId}, format: ${format}`)
    const output = path.join(config.VIDEO.OUTPUT_DIR, `${jobId}_${format}_final.mp4`)
    vpLog(`Input file: ${inputFilePath}`)
    vpLog(`Output file: ${output}`)
    const log = vpLog
    let progress = 0
    const updateProgress = (p) => {
      progress = p
      console.log(`Format ${format}: ${progress}% complete`)
      progressCallback(progress)
    }
    const targetWidth = config.VIDEO.FORMATS[format] || config.VIDEO.FORMATS['HD']
    await processVideoWithRetries(inputFilePath, output, targetWidth, log, updateProgress)
    const metadata = await getVideoDimensions(output)
    vpLog(`Format ${format} final video metadata: ${JSON.stringify(metadata)}`)
    return output
  }
```

