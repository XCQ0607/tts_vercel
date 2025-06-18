/**
 * Waveform processing module
 * Provides functions to generate audio waveform data from audio buffers
 */

// For MP3 decoding
const mp3Parser = require('mp3-parser');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Extract waveform data from MP3 buffer using a simplified approach
 * This is more compatible with server-side environments
 * 
 * @param {Buffer} audioBuffer - Audio buffer to process 
 * @param {number} samples - Number of data points to extract (default: 100)
 * @returns {Array<number>} Array of normalized amplitude values (0-1)
 */
async function extractWaveform(audioBuffer, samples = 100) {
  try {
    // Simple approach - sample the buffer directly at regular intervals
    // This works for most audio formats even without proper decoding
    // For better accuracy, you would need a proper audio decoder for each format
    
    // Ensure we have a buffer
    if (!Buffer.isBuffer(audioBuffer)) {
      audioBuffer = Buffer.from(audioBuffer);
    }
    
    // Skip any headers - most audio formats have headers in the first few KB
    // For MP3, typically skip the first 100-1000 bytes depending on the file
    const headerOffset = 1000; // Skip first 1KB to avoid headers
    const startPos = Math.min(headerOffset, Math.floor(audioBuffer.length * 0.1));
    
    // Calculate sampling interval
    const endPos = audioBuffer.length - 1;
    const samplingInterval = Math.floor((endPos - startPos) / samples);
    
    if (samplingInterval <= 0) {
      throw new Error('Audio buffer too small for requested samples');
    }
    
    // Extract samples as 8-bit unsigned values
    const waveform = [];
    for (let i = 0; i < samples; i++) {
      const pos = startPos + (i * samplingInterval);
      if (pos < audioBuffer.length) {
        // Get byte value and normalize to 0-1
        const value = audioBuffer[pos] / 255;
        waveform.push(value);
      }
    }
    
    // Ensure we have the requested number of samples
    while (waveform.length < samples) {
      waveform.push(0.5);
    }
    
    return waveform;
  } catch (error) {
    console.error('Error extracting waveform:', error);
    // Return flat waveform on error
    return Array(samples).fill(0.5);
  }
}

/**
 * Alternate method that tries to generate more meaningful waveform data
 * by looking at audio amplitude patterns
 * 
 * @param {Buffer} audioBuffer - Audio buffer to process
 * @param {number} samples - Number of data points to extract
 * @returns {Array<number>} Array of normalized amplitude values (0-1)
 */
async function extractAmplitudeWaveform(audioBuffer, samples = 100) {
  try {
    // Ensure we have a buffer
    if (!Buffer.isBuffer(audioBuffer)) {
      audioBuffer = Buffer.from(audioBuffer);
    }
    
    // Skip header
    const headerOffset = 1000;
    const dataStart = Math.min(headerOffset, Math.floor(audioBuffer.length * 0.05));
    
    // Divide the audio data into sample segments
    const dataLength = audioBuffer.length - dataStart;
    const blockSize = Math.floor(dataLength / samples);
    
    if (blockSize <= 0) {
      throw new Error('Audio buffer too small for requested samples');
    }
    
    const waveform = [];
    
    // Process each block to find amplitude
    for (let i = 0; i < samples; i++) {
      const startIdx = dataStart + (i * blockSize);
      const endIdx = Math.min(startIdx + blockSize, audioBuffer.length);
      
      let min = 255;
      let max = 0;
      
      // Find min/max in block
      for (let j = startIdx; j < endIdx; j++) {
        const value = audioBuffer[j];
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      
      // Calculate amplitude from min/max
      const amplitude = (max - min) / 255;
      waveform.push(amplitude);
    }
    
    // Normalize between 0.1 and 1.0 to ensure visibility
    const maxAmp = Math.max(...waveform, 0.1);
    const normalizedWaveform = waveform.map(amp => 
      0.1 + (0.9 * (amp / maxAmp))
    );
    
    return normalizedWaveform;
  } catch (error) {
    console.error('Error extracting amplitude waveform:', error);
    return Array(samples).fill(0.5);
  }
}

/**
 * 高级波形生成 - 使用更复杂的算法分析音频
 * 模拟WaveSurfer的峰值检测算法
 * 
 * @param {Buffer} audioBuffer - 音频缓冲区
 * @param {number} samples - 采样点数量
 * @returns {Array<number>} 波形数据点
 */
async function generateAdvancedWaveform(audioBuffer, samples = 100) {
  try {
    // 确保有buffer
    if (!Buffer.isBuffer(audioBuffer)) {
      audioBuffer = Buffer.from(audioBuffer);
    }
    
    // 跳过头部
    const headerOffset = 1000;
    const dataStart = Math.min(headerOffset, Math.floor(audioBuffer.length * 0.05));
    
    // 将音频数据分成多个块
    const dataLength = audioBuffer.length - dataStart;
    const blockSize = Math.floor(dataLength / samples);
    
    if (blockSize <= 0) {
      throw new Error('Audio buffer too small for requested samples');
    }
    
    // 预处理 - 将字节值转换为有符号值 (-128 到 127)
    const signedData = new Array(dataLength);
    for (let i = 0; i < dataLength; i++) {
      const byteValue = audioBuffer[dataStart + i];
      // 转换为有符号值
      signedData[i] = byteValue > 127 ? byteValue - 256 : byteValue;
    }
    
    const peaks = [];
    
    // 对每个块进行处理
    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, dataLength);
      
      // 查找块中的峰值
      let min = 0;
      let max = 0;
      
      for (let j = start; j < end; j++) {
        const value = signedData[j];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      
      // 使用较大的绝对值
      const peak = Math.max(Math.abs(min), Math.abs(max)) / 128; // 归一化到 0-1
      peaks.push(peak);
    }
    
    // 应用平滑处理
    const smoothedPeaks = smoothWaveform(peaks);
    
    // 确保波形有足够的对比度
    const enhancedPeaks = enhanceContrast(smoothedPeaks);
    
    return enhancedPeaks;
  } catch (error) {
    console.error('Error generating advanced waveform:', error);
    return Array(samples).fill(0.5);
  }
}

/**
 * 平滑波形数据
 */
function smoothWaveform(peaks, smoothingFactor = 0.5) {
  const smoothed = new Array(peaks.length);
  
  // 初始化第一个点
  smoothed[0] = peaks[0];
  
  // 应用平滑算法
  for (let i = 1; i < peaks.length; i++) {
    smoothed[i] = smoothingFactor * peaks[i] + (1 - smoothingFactor) * smoothed[i - 1];
  }
  
  return smoothed;
}

/**
 * 增强波形对比度
 */
function enhanceContrast(peaks, minHeight = 0.15) {
  const maxPeak = Math.max(...peaks, 0.1);
  
  // 应用对比度增强
  return peaks.map(peak => {
    // 确保最小高度
    const normalizedPeak = peak / maxPeak;
    return minHeight + (1 - minHeight) * normalizedPeak;
  });
}

/**
 * Generate a simple waveform visualization for the browser
 * @param {Buffer} audioBuffer - Audio buffer to process
 * @param {number} samples - Number of data points (default: 100)
 * @returns {Object} Waveform data for client-side visualization
 */
async function generateWaveformData(audioBuffer, samples = 100) {
  try {
    // 尝试使用高级波形生成
    const waveform = await generateAdvancedWaveform(audioBuffer, samples);
    
    return {
      success: true,
      points: waveform,
      numPoints: waveform.length
    };
  } catch (error) {
    console.error('Error generating waveform data:', error);
    
    // 回退到简单波形
    try {
      const simpleWaveform = await extractWaveform(audioBuffer, samples);
      return {
        success: true,
        points: simpleWaveform,
        numPoints: simpleWaveform.length
      };
    } catch (fallbackError) {
      console.error('Fallback waveform generation failed:', fallbackError);
      return {
        success: false,
        points: Array(samples).fill(0.5),
        numPoints: samples,
        error: error.message
      };
    }
  }
}

module.exports = {
  extractWaveform,
  extractAmplitudeWaveform,
  generateAdvancedWaveform,
  generateWaveformData
}; 