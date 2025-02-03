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
  