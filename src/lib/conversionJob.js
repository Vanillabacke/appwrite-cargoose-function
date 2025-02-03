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
