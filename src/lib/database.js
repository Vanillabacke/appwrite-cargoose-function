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


