# Cargoose API (Appwrite Function)

A Node.js (18.0) function for managing media conversion jobs via Appwrite. This function downloads an original video from storage `APPWRITE_STORAGE_BUCKET_ID`, converts it into multiple resolutions using FFmpeg and stores conversion and file information in an document `APPWRITE_STORAGE_DB_ID`/`APPWRITE_STORAGE_COLLECTION_ID` in Appwrite and integrates the converted files into the storage `APPWRITE_CONVERSION_STORAGE_BUCKET_ID`. During the process the function updates the docuemnt `APPWRITE_STORAGE_DB_ID`/`APPWRITE_STORAGE_COLLECTION_ID` with the conversion progress and metadata.


## Features

- **Event & HTTP Routing:** Handles both Appwrite events and HTTP requests.
- **Media Conversion:** Converts videos into multiple formats/resolutions.
- **Progress Updates:** Provides progress updates during download and conversion.
- **Storage & Database:** Uses Appwrite Storage and Database to manage files and metadata.
- **Background Processing:** Forks a background process to execute conversion jobs.

## Requirements

- Node.js v18
- Appwrite backend configured with:
- Storage buckets
- Databases & collections for media documents and task queues



## .env Example

Create a `.env` file with your own data. For example:

```shell
APPWRITE_FUNCTION_API_ENDPOINT="https://your-appwrite-instance/v1"
APPWRITE_ENDPOINT="https://your-appwrite-instance/v1"
APPWRITE_FUNCTION_PROJECT_ID="your_project_id"
APPWRITE_FUNCTION_API_KEY="your_api_key"

APPWRITE_STORAGE_BUCKET_ID="your_storage_bucket_id"
APPWRITE_CONVERSION_STORAGE_BUCKET_ID="your_conversion_bucket_id"

APPWRITE_TASK_QUEUE_DB_ID="your_task_queue_db_id"
APPWRITE_TASK_QUEUE_COLLECTION_ID="your_task_queue_collection_id"

APPWRITE_STORAGE_DB_ID="your_storage_db_id"
APPWRITE_STORAGE_COLLECTION_ID="your_storage_collection_id"

TEMP_DIR="tmp"
OUTPUT_DIR="tmp"
MAX_RETRIES=3
RETRY_DELAY_MS=5000
```


### Attributes of APPWRITE_STORAGE_COLLECTION_ID                                                                              
| Key            | Type       | Size     | Default Value | Description                                                                                          |
|----------------|------------|----------|---------------|------------------------------------------------------------------------------------------------------|
| fileId         | string     | 100      | -             | Unique file identifier in Appwrite Storage.                                                        |
| bucketId       | string     | 100      | -             | ID of the bucket where the file is stored.                                                          |
| name           | string     | 255      | -             | Name of the file.                                                                                   |
| mimeType       | string     | 255      | -             | MIME type of the file.                                                                              |
| size           | integer    | -        | -             | File size in bytes.                                                                                 |
| createdAt      | datetime   | -        | -             | Date and time when the file was created.                                                            |
| updatedAt      | datetime   | -        | -             | Date and time when the file was last updated.                                                       |
| isImage        | boolean    | -        | -             | Indicates whether the file is an image.                                                             |
| isVideo        | boolean    | -        | -             | Indicates whether the file is a video.                                                              |
| width          | integer    | -        | -             | Width of the image or video in pixels.                                                              |
| height         | integer    | -        | -             | Height of the image or video in pixels.                                                             |
| duration       | double     | -        | -             | Duration of the video in seconds.                                                                   |
| ownerId        | string     | 100      | -             | ID of the user who uploaded the file.                                                               |
| visibility     | enum       | -        | -             | Visibility of the file (typically 'private', 'public', or 'shared').                                 |
| sharedWith     | string []  | 1024     | -             | Array of user IDs (each 36 characters) who have access to the file.                                 |
| tags           | string []  | 1024     | -             | Custom tags used to organize files (each tag up to 50 characters).                                   |
| description    | string     | 2048     | -             | Description of the file.                                                                            |
| lastAccessedAt | datetime   | -        | -             | Date and time when the file was last accessed.                                                      |
| deletedAt      | datetime   | -        | -             | Date and time when the file was deleted.                                                            |
| hash           | string     | 1024     | -             | Checksum of the file for integrity verification.                                                  |
| processingTime | double     | -        | -             | Time taken to process the file (e.g., during conversion) in seconds.                                |
| formats        | string []  | 1638400  | -             | Array containing metadata for different conversion formats.                                       |
| metaData       | string     | 1638400  | -             | Additional metadata about the file or the conversion process.                                     |


```json
"attributes": [
  {
      "key": "originalFileId",
      "type": "string",
      "required": true,
      "array": false,
      "size": 1638400,
      "default": null
  },
  {
      "key": "uploadedAt",
      "type": "datetime",
      "required": true,
      "array": false,
      "format": "",
      "default": null
  },
  {
      "key": "convertedFormats",
      "type": "string",
      "required": false,
      "array": true,
      "size": 1638400,
      "default": null
  },
  {
      "key": "conversionQueue",
      "type": "string",
      "required": false,
      "array": true,
      "size": 1638400,
      "default": null
  },
  {
      "key": "fileName",
      "type": "string",
      "required": false,
      "array": false,
      "size": 1638400,
      "default": null
  },
  {
      "key": "metaData",
      "type": "string",
      "required": false,
      "array": false,
      "size": 1638400,
      "default": null
  }
]
```

## Project Structure
```pgsql
cargoose-api/
├── .env
├── package.json
└── src/
    ├── main.js
    ├── lib/
    │   ├── backgroundProcess.js
    │   ├── config.js
    │   ├── conversionJob.js
    │   ├── database.js
    │   ├── router.js
    │   ├── storage.js
    │   └── videoProcessor.js
    └── handlers/
        ├── eventHandler.js
        └── httpHandler.js
```
- **main.js:** Entry point that validates the configuration and routes requests.
- **lib/config.js:** Loads environment variables and validates the configuration.
- **lib/database.js:** Communicates with the Appwrite Database for media documents.
- **lib/storage.js:** Handles file downloads, uploads, and deletions via Appwrite Storage.
- **lib/videoProcessor.js:** Processes video conversion using FFmpeg.
- **lib/conversionJob.js:** Coordinates download, conversion, and upload of video formats.
- **lib/backgroundProcess.js:** Executes conversion jobs in a forked background process.
- **lib/router.js:** Routes requests to the appropriate handler.
- **handlers/eventHandler.js & httpHandler.js:** Process Appwrite events and HTTP requests respectively.





# Usage Examples
## HTTP POST (Create or Update a Conversion Job)
```bash
curl -X POST https://your-function-endpoint \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "file_id_12345",
    "formats": ["1080p", "720p"],
    "name": "Sample Video"
  }'
```
- If a media document for the given 'fileId' already exists, the conversion formats will be updated.
- Otherwise, a new media document is created and a background process is forked to handle the conversion.

## HTTP DELETE (Delete a Conversion Job or Specific Formats)
Send a DELETE request with a JSON payload. For example, to delete specific formats:
```bash
curl -X DELETE https://your-function-endpoint \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "file_12345",
    "formats": ["720p"]
  }'
```
Or to delete the entire media document along with all formats:
```bash
curl -X DELETE https://your-function-endpoint \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "file_12345"
  }'
```


## Appwrite Events (planned)
The function also listens for Appwrite events (e.g., `.create` and `.delete`) to automatically create or delete media documents. Ensure your Appwrite project is configured to send these events to the function endpoint.