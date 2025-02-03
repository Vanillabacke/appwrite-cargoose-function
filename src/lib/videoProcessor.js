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