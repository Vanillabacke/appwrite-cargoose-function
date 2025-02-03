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