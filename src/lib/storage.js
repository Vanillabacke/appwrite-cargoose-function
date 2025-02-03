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