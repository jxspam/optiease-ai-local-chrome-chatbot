// CRASH-PROOF Chrome AI Session Manager
// Prevents Chrome's crash lockout by never retrying on fatal errors
class ChromeAISession {
  static #permanentlyDisabled = false; // One-way flag: once disabled, never retry
  static #lastFailureReason = null;
  #session = null;
  #creating = null; // Promise to prevent duplicate creation
  #isAvailable = null; // Cache availability check

  async #create() {
    console.log('🔧 Creating new AI session...');

    // STEP 1: Check if permanently disabled (crash lockout)
    if (ChromeAISession.#permanentlyDisabled) {
      console.error('❌ Chrome AI is permanently disabled for this session');
      console.error(`   Reason: ${ChromeAISession.#lastFailureReason}`);
      throw new Error(`PERMANENTLY_DISABLED: ${ChromeAISession.#lastFailureReason}`);
    }

    // STEP 2: Check if LanguageModel API exists
    if (typeof LanguageModel === 'undefined') {
      ChromeAISession.#permanentlyDisabled = true;
      ChromeAISession.#lastFailureReason = 'LanguageModel API not available in this browser';
      throw new Error('PERMANENTLY_DISABLED: Chrome AI not available in this browser');
    }

    try {
      // STEP 3: Check availability (with caching to avoid repeated calls)
      if (this.#isAvailable === null) {
        console.log('📊 Checking model availability...');
        const availability = await LanguageModel.availability();
        console.log(`   Status: ${availability}`);

        // Cache the result
        this.#isAvailable = availability;

        // If unavailable, PERMANENTLY disable to prevent retries
        if (availability === 'unavailable') {
          ChromeAISession.#permanentlyDisabled = true;
          ChromeAISession.#lastFailureReason = 'Model reported as unavailable (likely crashed too many times)';
          throw new Error('PERMANENTLY_DISABLED: Model unavailable. Restart Chrome and report crashes via chrome://crashes');
        }

        if (availability === 'downloadable' || availability === 'downloading') {
          console.log('⬇️ Model needs to be downloaded (this may take a while)...');
        }
      }

      // STEP 4: Get creation options from UI (with safe defaults)
      const temperature = parseFloat(document.getElementById('temperatureSlider')?.value || 0.7);
      const topK = parseInt(document.getElementById('topKSlider')?.value || 40);

      // STEP 5: Use MINIMAL configuration to reduce crash risk
      const creationOptions = {
        temperature: Math.max(0, Math.min(2, temperature)), // Clamp to valid range
        topK: Math.max(1, Math.min(100, topK)), // Clamp to valid range
        // Enable multimodal support for image processing
        // Note: Audio is NOT currently supported by Chrome's Gemini Nano
        expectedInputs: [
          { type: 'text' },
          { type: 'image' }
          // { type: 'audio' } // Not supported yet by Gemini Nano
        ],
        expectedOutputs: [
          { type: 'text', languages: ['en'] }
        ],
        // Monitor download progress
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            const percent = (e.loaded * 100).toFixed(1);
            console.log(`⬇️ Download: ${percent}%`);
            
            // Update UI elements
            const progressEl = document.getElementById('modelDownloadProgress');
            const statusBadge = document.getElementById('statusBadge');
            const statusMessage = document.getElementById('statusMessage');
            
            if (progressEl) {
              progressEl.style.display = 'block';
              progressEl.value = e.loaded;
            }
            if (statusBadge) {
              statusBadge.className = 'status-badge downloading';
              statusBadge.innerHTML = '<span class="spinner"></span> Downloading...';
            }
            if (statusMessage) {
              statusMessage.textContent = `Downloading model: ${percent}% complete`;
            }
          });
        }
      };

      console.log('Creating session with minimal config (text-only)...');

      // STEP 6: Create session (NO RETRY - fail fast)
      const newSession = await LanguageModel.create(creationOptions);

      // Hide progress indicator
      const progressEl = document.getElementById('modelDownloadProgress');
      if (progressEl) {
        progressEl.style.display = 'none';
      }

      console.log('✅ Session created successfully');
      console.log(`   Quota: ${newSession.inputQuota || 'unknown'} tokens`);
      console.log(`   Usage: ${newSession.inputUsage || 'unknown'} tokens`);

      // STEP 7: Set up quota overflow handler (non-critical)
      try {
        newSession.addEventListener('quotaoverflow', () => {
          console.warn('⚠️ Context window quota exceeded - oldest messages dropped');
        });
      } catch (e) {
        // Ignore if addEventListener not supported
      }

      return newSession;

    } catch (err) {
      console.error('❌ Session creation failed:', err);

      // Hide progress indicator
      const progressEl = document.getElementById('modelDownloadProgress');
      if (progressEl) {
        progressEl.style.display = 'none';
      }

      const msg = String(err?.message || '');
      const name = String(err?.name || '');

      // CRITICAL: Detect crash lockout and PERMANENTLY disable
      const crashedTooMany = /crashed too many times/i.test(msg) ||
        /unavailable/i.test(msg) ||
        (name === 'NotAllowedError');

      if (crashedTooMany) {
        // PERMANENTLY disable - never retry
        ChromeAISession.#permanentlyDisabled = true;
        ChromeAISession.#lastFailureReason = 'Model crashed too many times. Chrome has disabled it.';

        try {
          localStorage.setItem('chrome-ai-disabled', 'true');
          localStorage.setItem('chrome-ai-disabled-reason', ChromeAISession.#lastFailureReason);
          localStorage.setItem('chrome-ai-disabled-time', Date.now().toString());
        } catch { }

        console.error('');
        console.error('═══════════════════════════════════════════════════════════');
        console.error('❌ CHROME AI PERMANENTLY DISABLED');
        console.error('═══════════════════════════════════════════════════════════');
        console.error('');
        console.error('The model has crashed too many times and Chrome has disabled it.');
        console.error('');
        console.error('RECOVERY STEPS:');
        console.error('1. Close ALL Chrome tabs and windows');
        console.error('2. Enable crash reporting in Chrome settings');
        console.error('3. Visit chrome://crashes and send ALL crash reports');
        console.error('4. Restart Chrome completely');
        console.error('5. If still broken, update Chrome to latest version');
        console.error('');
        console.error('DO NOT reload this page - it will not help.');
        console.error('═══════════════════════════════════════════════════════════');
        console.error('');

        throw new Error('PERMANENTLY_DISABLED: ' + ChromeAISession.#lastFailureReason);
      }

      // Other errors: also disable permanently to be safe
      // Better to fail gracefully than trigger more crashes
      ChromeAISession.#permanentlyDisabled = true;
      ChromeAISession.#lastFailureReason = `Session creation failed: ${name || 'Unknown error'}`;

      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        console.error('❌ QuotaExceededError: Configuration exceeds quota');
        console.error(`   This should not happen with minimal config - model may be unstable`);
      }

      if (err instanceof DOMException && err.name === 'NetworkError') {
        console.error('❌ NetworkError: Failed to download model');
        console.error('   Check internet connection and disk space');
      }

      throw err;
    }
  }

  async ensure() {
    // If permanently disabled, fail immediately
    if (ChromeAISession.#permanentlyDisabled) {
      throw new Error(`PERMANENTLY_DISABLED: ${ChromeAISession.#lastFailureReason}`);
    }

    // If already creating, wait for that (prevents duplicate requests)
    if (this.#creating) {
      console.log('⏳ Waiting for existing session creation...');
      return this.#creating;
    }

    // If session exists and not destroyed, return it
    if (this.#session) {
      try {
        // Test if session is still valid by checking a property
        // DO NOT call any methods - that could crash
        const isValid = this.#session && typeof this.#session.prompt === 'function';
        if (isValid) {
          return this.#session;
        }
      } catch (e) {
        // Session check failed - clear it
        console.warn('Session check failed, recreating...');
        this.#session = null;
      }
    }

    // Create new session (ONLY ONCE - no retries)
    this.#creating = this.#create();
    try {
      this.#session = await this.#creating;
      return this.#session;
    } catch (err) {
      // If creation fails, permanently disable
      ChromeAISession.#permanentlyDisabled = true;
      throw err;
    } finally {
      this.#creating = null;
    }
  }

  async prompt(input, options = {}) {
    // NO RETRIES - one attempt only
    // If it fails, the error is propagated immediately
    // This prevents triggering multiple crashes

    try {
      const s = await this.ensure(); // May throw if permanently disabled

      // Use streaming if requested
      if (options.stream) {
        return await s.promptStreaming(input, options);
      } else {
        return await s.prompt(input, options);
      }

    } catch (err) {
      const name = String(err?.name || '');
      const msg = String(err?.message || '');

      // If permanently disabled, show clear message
      if (msg.includes('PERMANENTLY_DISABLED')) {
        console.error('❌ Cannot prompt: Chrome AI is permanently disabled');
        console.error('   Restart Chrome to recover');
        throw err;
      }

      // InvalidStateError: Session destroyed
      // DO NOT RETRY - this could trigger more crashes
      if (err instanceof DOMException && err.name === 'InvalidStateError') {
        console.error('❌ InvalidStateError: Session destroyed');
        console.error('   Model may have been purged by Chrome');
        console.error('   Refresh the page and restart Chrome if needed');

        // Clear the session but don't retry
        this.#session = null;

        // Permanently disable to prevent retry loops
        ChromeAISession.#permanentlyDisabled = true;
        ChromeAISession.#lastFailureReason = 'Session destroyed mid-conversation';

        throw new Error('PERMANENTLY_DISABLED: Session destroyed. Refresh page and restart Chrome.');
      }

      // QuotaExceededError: Prompt too large
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        console.error('❌ QuotaExceededError: Prompt exceeds token quota');
        console.error('   Try a shorter message or start a new chat');
        throw err; // Let caller handle
      }

      // AbortError: User cancelled
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.log('ℹ️ Request cancelled by user');
        throw err; // Expected, not an error
      }

      // Any other error: also disable permanently
      console.error('❌ Unexpected error during prompt:', err);
      ChromeAISession.#permanentlyDisabled = true;
      ChromeAISession.#lastFailureReason = `Prompt failed: ${name}`;

      throw err;
    }
  }

  async destroy() {
    try {
      if (this.#session && typeof this.#session.destroy === 'function') {
        await this.#session.destroy();
      }
    } catch (e) {
      console.warn('Error destroying session:', e);
    }
    this.#session = null;
    this.#creating = null;
  }

  async reset() {
    // Reset the session by destroying the old one and clearing flags
    // This allows a new session to be created on the next ensure() call
    // Only works if not permanently disabled
    if (ChromeAISession.#permanentlyDisabled) {
      throw new Error(`Cannot reset: ${ChromeAISession.#lastFailureReason}`);
    }

    console.log('🔄 Resetting AI session...');
    await this.destroy();
    console.log('✓ Session reset complete - will create fresh session on next use');
  }

  get currentSession() {
    return this.#session;
  }

  isDisabled() {
    return ChromeAISession.#permanentlyDisabled;
  }

  getDisabledReason() {
    return ChromeAISession.#lastFailureReason;
  }
}

// Global session manager instance
const aiSession = new ChromeAISession();

// Legacy compatibility - keep the old 'session' variable for backward compatibility
let session = null;
let currentChatId = null;
let messageHistory = [];
let lastUserPrompt = ''; // Store last prompt for regeneration
const DB_NAME = 'ChromeAI';
const DB_VERSION = 1;
let MAX_STORAGE = 100 * 1024 * 1024; // 100MB - will be updated by user setting
let maxResponseWords = 500; // -1 means unlimited
let wordLimitEnabled = false;
let storageLimitEnabled = true;
let initRetryCount = 0; // Track retry attempts
const MAX_INIT_RETRIES = 2; // Limit retries to avoid infinite loop

// File widget state
let uploadedFiles = {}; // { fileId: { name, content, status } }

// SVG Icons for ChatGPT-style UI
const SVG_ICONS = {
  user: `<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
  copy: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`,
  edit: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  regenerate: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2"/></svg>`,
  send: `<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
  stop: `<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`,
  attachment: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`
};

// Helper function to get file type icon
function getFileTypeIcon(fileName, mimeType) {
  const ext = fileName.split('.').pop().toLowerCase();
  const type = mimeType.toLowerCase();

  // Check for YouTube first
  if (type === 'video/youtube' || fileName.includes('youtube.com') || fileName.includes('youtu.be')) {
    return '<img src="ui-svg-pack/file-youtube.svg" class="file-type-icon" alt="YouTube">';
  }

  // Map file extensions and MIME types to icon paths
  if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) {
    return '<img src="ui-svg-pack/file-image.svg" class="file-type-icon" alt="Image">';
  } else if (type.includes('pdf') || ext === 'pdf') {
    return '<img src="ui-svg-pack/file-pdf.svg" class="file-type-icon" alt="PDF">';
  } else if (type.includes('word') || type.includes('document') || ['doc', 'docx'].includes(ext)) {
    return '<img src="ui-svg-pack/file-doc.svg" class="file-type-icon" alt="Document">';
  } else if (type.includes('powerpoint') || type.includes('presentation') || ['ppt', 'pptx'].includes(ext)) {
    return '<img src="ui-svg-pack/file-ppt.svg" class="file-type-icon" alt="PowerPoint">';
  } else if (type.includes('excel') || type.includes('spreadsheet') || ['xls', 'xlsx'].includes(ext)) {
    return '<img src="ui-svg-pack/file-xls.svg" class="file-type-icon" alt="Excel">';
  } else if (type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) {
    return '<img src="ui-svg-pack/file-audio.svg" class="file-type-icon" alt="Audio">';
  } else if (type.includes('html') || ext === 'html' || ext === 'htm') {
    return '<img src="ui-svg-pack/file-html.svg" class="file-type-icon" alt="HTML">';
  } else if (ext === 'csv') {
    return '<img src="ui-svg-pack/file-csv.svg" class="file-type-icon" alt="CSV">';
  } else if (type.includes('json') || ext === 'json') {
    return '<img src="ui-svg-pack/file-json.svg" class="file-type-icon" alt="JSON">';
  } else if (type.includes('xml') || ext === 'xml') {
    return '<img src="ui-svg-pack/file-xml.svg" class="file-type-icon" alt="XML">';
  } else if (type.includes('zip') || type.includes('compressed') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return '<img src="ui-svg-pack/file-zip.svg" class="file-type-icon" alt="Archive">';
  } else if (ext === 'txt' || type.includes('text/plain')) {
    return '<img src="ui-svg-pack/file-txt.svg" class="file-type-icon" alt="Text">';
  } else {
    return '<img src="ui-svg-pack/file.svg" class="file-type-icon" alt="File">';
  }
}

// IndexedDB Setup
function initializeDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Chats object store
      if (!db.objectStoreNames.contains('chats')) {
        const chatStore = db.createObjectStore('chats', { keyPath: 'id' });
        chatStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Messages object store
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('chatId', 'chatId', { unique: false });
      }
    };
  });
}

// Handle file uploads with widget display
async function handleFileUpload(files) {
  if (!files || files.length === 0) return;

  const uploadBtn = document.getElementById('uploadBtn');
  const fileWidget = document.getElementById('fileWidget');
  const fileList = document.getElementById('fileList');

  uploadBtn.disabled = true;
  fileWidget.classList.add('show');

  const CONVERSION_SERVER = 'http://localhost:5000'; // MarkItDown server
  const fileProcessingPromises = []; // Track all file processing promises

  for (const file of files) {
    const fileId = Date.now().toString() + Math.random().toString(36);
    const fileName = file.name;

    // Try to get the full file path
    let filePath = file.name; // Default to just filename

    // Try multiple methods to get file path
    if (file.fullPath) {
      filePath = file.fullPath; // From File System Access API
    } else if (file.webkitRelativePath) {
      filePath = file.webkitRelativePath; // From directory upload
    } else if (file.path) {
      filePath = file.path; // Some environments expose this
    }

    // Store file handle if available for future access
    let fileHandle = file.fileHandle || null;

    // Get appropriate file icon based on type
    const fileIcon = getFileTypeIcon(fileName, file.type);

    // Create file item in widget
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.id = `file-${fileId}`;
    fileItem.innerHTML = `
      ${fileIcon}
      <span class="file-item-name" title="${filePath}">${fileName}</span>
      <span class="file-item-status">
        <span class="file-item-loading"></span>
      </span>
    `;
    fileList.appendChild(fileItem);

    // Store file metadata with file path and handle
    uploadedFiles[fileId] = {
      name: fileName,
      path: filePath, // Store the file path reference
      fileHandle: fileHandle, // Store file handle if available
      content: '',
      status: 'loading',
      type: file.type,
      icon: fileIcon
    };

    // Process file asynchronously
    const processingPromise = (async () => {
      try {
        let fileContent = '';

        if (file.type === 'video/youtube') {
          // Handle YouTube URL
          uploadedFiles[fileId].youtubeUrl = file.youtubeUrl;

          console.log('🎬 Processing YouTube URL:', file.youtubeUrl);

          // Try to convert via MarkItDown server for transcript extraction
          try {
            console.log('📡 Sending request to server:', `${CONVERSION_SERVER}/convert`);
            const response = await fetch(`${CONVERSION_SERVER}/convert`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ url: file.youtubeUrl })
            });

            console.log('📥 Server response status:', response.status);

            if (response.ok) {
              const result = await response.json();
              console.log('✅ Server response:', result);
              if (result.success && result.text) {
                fileContent = result.text;
                console.log('📄 Transcript extracted:', fileContent.substring(0, 200) + '...');
              } else {
                console.error('❌ Server returned error:', result.error);
                throw new Error(result.error || 'Transcript extraction failed');
              }
            } else {
              const errorText = await response.text();
              console.error('❌ Server error response:', errorText);
              throw new Error(`Server error: ${response.status}`);
            }
          } catch (serverError) {
            console.error('❌ YouTube transcript extraction failed:', serverError);
            console.error('   Error details:', serverError.message, serverError.stack);
            fileContent = `[YouTube Video: ${file.youtubeUrl}]`;
          }

        } else if (file.type.startsWith('image/')) {
          // Store the actual image file for multimodal prompting
          const reader = new FileReader();
          const imageData = await new Promise((resolve, reject) => {
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          // Get image dimensions
          const img = new Image();
          const imgInfo = await new Promise((resolve) => {
            img.onload = () => {
              resolve({
                width: img.width,
                height: img.height,
                size: (file.size / 1024).toFixed(2) + ' KB'
              });
            };
            img.src = imageData;
          });

          // Store the File object AND base64 data for persistence
          uploadedFiles[fileId].file = file;
          uploadedFiles[fileId].fileData = imageData; // Store base64 data for database
          uploadedFiles[fileId].imageInfo = imgInfo;

          // Display metadata in chat
          fileContent = `[Image: ${fileName} - ${imgInfo.width}x${imgInfo.height}, ${imgInfo.size}]`;

        } else if (file.type.startsWith('audio/')) {
          // Store the actual audio file for multimodal prompting
          const reader = new FileReader();
          const audioData = await new Promise((resolve, reject) => {
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          // Get audio duration
          const audio = new Audio();
          const audioInfo = await new Promise((resolve) => {
            audio.onloadedmetadata = () => {
              const duration = audio.duration;
              const minutes = Math.floor(duration / 60);
              const seconds = Math.floor(duration % 60);
              resolve({
                duration: `${minutes}:${seconds.toString().padStart(2, '0')}`,
                size: (file.size / 1024).toFixed(2) + ' KB'
              });
            };
            audio.onerror = () => resolve({ duration: 'Unknown', size: (file.size / 1024).toFixed(2) + ' KB' });
            audio.src = audioData;
          });

          // Store the File object AND base64 data for persistence
          uploadedFiles[fileId].file = file;
          uploadedFiles[fileId].fileData = audioData; // Store base64 data for database
          uploadedFiles[fileId].audioInfo = audioInfo;

          // Display metadata in chat with warning
          fileContent = `[Audio: ${fileName} - ${audioInfo.duration}, ${audioInfo.size}]\n⚠️ Note: Audio files are displayed but cannot be processed by the AI (not supported).`;

        } else {
          // For PDF and other documents, store both the file data AND extracted text
          // First, read the file as base64 for storage
          const reader = new FileReader();
          const fileData = await new Promise((resolve, reject) => {
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          // Store the complete file data
          uploadedFiles[fileId].fileData = fileData; // Store base64 for persistence

          // Try to convert via MarkItDown server for text extraction
          try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${CONVERSION_SERVER}/convert`, {
              method: 'POST',
              body: formData
            });

            if (response.ok) {
              const result = await response.json();
              if (result.success && result.text) {
                fileContent = result.text;
              } else {
                throw new Error(result.error || 'Conversion failed');
              }
            } else {
              throw new Error(`Server error: ${response.status}`);
            }
          } catch (serverError) {
            console.warn(`Could not reach conversion server for ${fileName}:`, serverError);
            // Fallback to text reading
            try {
              fileContent = await file.text();
            } catch (e) {
              // If can't read as text, just use filename
              fileContent = `[File: ${fileName}]`;
            }
          }
        }

        // Update file item status - check if still exists
        if (uploadedFiles[fileId]) {
          uploadedFiles[fileId].content = fileContent;
          uploadedFiles[fileId].status = 'success';

          // Create a URL for the file (blob for regular files, direct URL for YouTube)
          let fileURL;
          if (file.type === 'video/youtube') {
            fileURL = file.youtubeUrl;
          } else {
            fileURL = URL.createObjectURL(file);
          }
          uploadedFiles[fileId].fileURL = fileURL;

          const fileItemEl = document.getElementById(`file-${fileId}`);
          if (fileItemEl) {
            fileItemEl.className = 'file-item success';
            fileItemEl.style.cursor = 'pointer';
            fileItemEl.innerHTML = `
              ${uploadedFiles[fileId].icon}
              <span class="file-item-name" title="Click to open: ${fileName}">${fileName}</span>
              <span class="file-item-status">✅ Ready</span>
            `;

            // Make the file item clickable to open the file
            fileItemEl.onclick = () => {
              window.open(fileURL, '_blank');
            };
          }
        }

      } catch (error) {
        console.error(`Error processing ${fileName}:`, error);

        // Update status only if entry still exists
        if (uploadedFiles[fileId]) {
          uploadedFiles[fileId].status = 'error';

          const fileItemEl = document.getElementById(`file-${fileId}`);
          if (fileItemEl) {
            fileItemEl.className = 'file-item error';
            fileItemEl.innerHTML = `
              ${uploadedFiles[fileId].icon}
              <span class="file-item-name" title="${fileName}">${fileName}</span>
              <span class="file-item-status">❌ Failed</span>
            `;
          }
        }
      }
    })();

    // Track this file processing promise
    fileProcessingPromises.push(processingPromise);
  }

  // Wait for all files to finish processing
  await Promise.allSettled(fileProcessingPromises);

  uploadBtn.disabled = false;
}

// Clear file widget
function clearFileWidget() {
  const fileWidget = document.getElementById('fileWidget');
  const fileList = document.getElementById('fileList');
  fileWidget.classList.remove('show');
  fileList.innerHTML = '';
  uploadedFiles = {};
}

// Check if all files are processed
function areFilesReady() {
  for (const fileId in uploadedFiles) {
    if (uploadedFiles[fileId].status === 'loading') {
      return false;
    }
  }
  return true;
}

// Generate chat title from first message (max 30 chars)
function generateChatTitle(text) {
  const cleanText = text.trim().substring(0, 50);
  if (cleanText.length < 50) {
    return cleanText;
  }
  return cleanText.substring(0, 47) + '...';
}

// Save chat
async function saveChat(title) {
  const db = await initializeDB();
  const chat = {
    id: Date.now().toString(),
    title: title || 'New Chat',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['chats'], 'readwrite');
    const store = tx.objectStore('chats');
    const request = store.add(chat);

    request.onsuccess = () => {
      currentChatId = chat.id;
      loadChatHistory();
      resolve(chat);
    };
    request.onerror = () => reject(request.error);
  });
}

// Save message
async function saveMessage(role, content, files = []) {
  // Store file metadata including path reference and file data
  const fileMetadata = files.map(f => ({
    name: f.name,
    path: f.path || f.name,
    icon: f.icon,
    type: f.type,
    content: f.content,
    fileData: f.fileData,
    imageInfo: f.imageInfo,
    audioInfo: f.audioInfo,
  }));

  const message = {
    id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 15),
    chatId: currentChatId,
    role: role,
    content: content,
    files: fileMetadata,
    timestamp: new Date().toISOString()
  };

  messageHistory.push(message);

  // Try to save to server if enabled, fallback to IndexedDB
  if (useServerStorage) {
    const chatData = {
      chat_id: currentChatId,
      chat_title: document.querySelector(`[data-chat-id="${currentChatId}"]`)?.textContent || 'Untitled Chat',
      messages: messageHistory,
      created_at: messageHistory[0]?.timestamp,
      updated_at: message.timestamp
    };

    const serverSaved = await saveSessionToServer(chatData);
    if (serverSaved) {
      console.log('💾 Message saved to server storage');
      return message;
    }
    console.warn('⚠️ Server storage failed, falling back to IndexedDB');
  }

  // Fallback to IndexedDB
  const db = await initializeDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['messages'], 'readwrite');
    const store = tx.objectStore('messages');
    const request = store.add(message);

    request.onsuccess = () => {
      updateStorageInfo();
      resolve(message);
    };
    request.onerror = () => {
      if (request.error.name === 'ConstraintError') {
        console.warn('Duplicate message ID detected, retrying with new ID...');
        setTimeout(() => {
          saveMessage(role, content, files).then(resolve).catch(reject);
        }, 10);
      } else {
        reject(request.error);
      }
    };
  });
}

// Load chat history
async function loadChatHistory() {
  if (!currentChatId) return;

  messageHistory = [];

  // Load from server if server storage is enabled
  if (useServerStorage) {
    try {
      const sessionData = await loadSessionFromServer(currentChatId);
      if (sessionData && sessionData.messages) {
        messageHistory = sessionData.messages.sort((a, b) =>
          new Date(a.timestamp) - new Date(b.timestamp)
        );

        // Find the last user message to restore lastUserPrompt for regeneration
        for (let i = messageHistory.length - 1; i >= 0; i--) {
          if (messageHistory[i].role === 'user') {
            lastUserPrompt = messageHistory[i].content;
            console.log('Restored last user prompt for regeneration from server');
            break;
          }
        }

        console.log(`📖 Loaded ${messageHistory.length} messages from server for chat ${currentChatId}`);
        return messageHistory;
      }
    } catch (error) {
      console.error('Error loading from server:', error);
      // Fall through to IndexedDB
    }
  }

  // Fallback to IndexedDB
  const db = await initializeDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['messages'], 'readonly');
    const store = tx.objectStore('messages');
    const index = store.index('chatId');
    const request = index.getAll(currentChatId);

    request.onsuccess = () => {
      messageHistory = request.result.sort((a, b) =>
        new Date(a.timestamp) - new Date(b.timestamp)
      );

      // Find the last user message to restore lastUserPrompt for regeneration
      for (let i = messageHistory.length - 1; i >= 0; i--) {
        if (messageHistory[i].role === 'user') {
          lastUserPrompt = messageHistory[i].content;
          console.log('Restored last user prompt for regeneration from IndexedDB');
          break;
        }
      }

      console.log(`📖 Loaded ${messageHistory.length} messages from IndexedDB for chat ${currentChatId}`);
      resolve(messageHistory);
    };
    request.onerror = () => reject(request.error);
  });
}

// Load all chats
async function loadAllChats() {
  const db = await initializeDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['chats'], 'readonly');
    const store = tx.objectStore('chats');
    const index = store.index('createdAt');
    const request = index.getAll();

    request.onsuccess = () => {
      const chats = request.result.reverse();
      populateChatList(chats);
      resolve(chats);
    };
    request.onerror = () => reject(request.error);
  });
}

// Populate chat list
function populateChatList(chats) {
  const chatList = document.getElementById('chatList');
  chatList.innerHTML = '';

  chats.forEach(chat => {
    const item = document.createElement('button');
    item.className = `chat-item ${currentChatId === chat.id ? 'active' : ''}`;
    item.textContent = chat.title;
    item.onclick = () => selectChat(chat.id);
    chatList.appendChild(item);
  });
}

// Select chat
async function selectChat(chatId) {
  currentChatId = chatId;
  document.getElementById('chatArea').innerHTML = '';
  await loadChatHistory();

  // Reset the AI session to clear context from the previous chat
  // The messageHistory will be loaded and can be sent to provide context
  try {
    await aiSession.reset();
    session = await aiSession.ensure();
    console.log('✅ Switched to chat:', chatId, '(fresh session created)');
  } catch (error) {
    console.error('Error resetting session when switching chats:', error);
  }

  // Restore messages to UI
  // Find the indices of the last user and last assistant messages
  let lastUserIndex = -1;
  let lastAssistantIndex = -1;

  for (let i = messageHistory.length - 1; i >= 0; i--) {
    if (messageHistory[i].role === 'user' && lastUserIndex === -1) {
      lastUserIndex = i;
    }
    if (messageHistory[i].role === 'assistant' && lastAssistantIndex === -1) {
      lastAssistantIndex = i;
    }
    if (lastUserIndex !== -1 && lastAssistantIndex !== -1) break;
  }

  messageHistory.forEach((msg, index) => {
    // Only the very last user message and very last assistant message get action buttons
    const isLastMessage = (msg.role === 'user' && index === lastUserIndex) ||
      (msg.role === 'assistant' && index === lastAssistantIndex);

    // Restore files from stored metadata and recreate File objects from base64 data
    const restoredFiles = (msg.files || []).map(f => {
      const restoredFile = { ...f };

      // If we have base64 data, recreate the File object
      if (f.fileData && f.type) {
        try {
          // Convert base64 to blob
          const byteString = atob(f.fileData.split(',')[1]);
          const mimeString = f.fileData.split(',')[0].split(':')[1].split(';')[0];
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type: mimeString });

          // Create File object from blob
          const file = new File([blob], f.name, { type: mimeString });
          restoredFile.file = file;
        } catch (e) {
          console.warn('Could not recreate File object for', f.name, e);
        }
      }

      return restoredFile;
    });

    addMessageToUI(msg.role, msg.content, isLastMessage, restoredFiles, msg.timestamp);
  });

  loadAllChats();
}

// Update storage info
async function updateStorageInfo() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage;
      const percent = ((used / MAX_STORAGE) * 100).toFixed(1);

      const storageInfo = document.getElementById('storageInfo');
      if (storageInfo) {
        const usedMB = (used / (1024 * 1024)).toFixed(1);
        storageInfo.textContent = `${usedMB}MB / 100MB`;

        // Change color based on usage
        if (percent > 80) {
          storageInfo.style.color = '#dc2626';
        } else if (percent > 50) {
          storageInfo.style.color = '#ea580c';
        } else {
          storageInfo.style.color = '#10a37f';
        }
      }
    }
  } catch (e) {
    console.error('Error getting storage info:', e);
  }
}

// Clear old chats if needed
async function clearOldChats() {
  const estimate = await navigator.storage.estimate();
  if (estimate.usage > MAX_STORAGE * 0.95) {
    const db = await initializeDB();
    const chats = await loadAllChats();

    if (chats.length > 0) {
      const oldestChat = chats[chats.length - 1];
      await deleteChat(oldestChat.id);
    }
  }
}

// Delete chat and its messages
async function deleteChat(chatId) {
  const db = await initializeDB();

  // Delete chat
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['chats'], 'readwrite');
    const store = tx.objectStore('chats');
    const request = store.delete(chatId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // Delete messages
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['messages'], 'readwrite');
    const store = tx.objectStore('messages');
    const index = store.index('chatId');
    const request = index.getAll(chatId);

    request.onsuccess = () => {
      request.result.forEach(msg => store.delete(msg.id));
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

  if (currentChatId === chatId) {
    currentChatId = null;
    messageHistory = [];
    document.getElementById('chatArea').innerHTML = `
      <div class="welcome-message">
        <h2>Optiease AI</h2>
        <p>Chat deleted</p>
        <p>Create a new chat to continue</p>
      </div>
    `;
  }

  await loadAllChats();
  updateStorageInfo();
}

// Trigger Gemini Nano download (must be called from user gesture)
async function downloadGeminiNano() {
  console.log("Starting Gemini Nano download...");
  
  const statusBadge = document.getElementById('statusBadge');
  const statusMessage = document.getElementById('statusMessage');
  const downloadBtn = document.getElementById('downloadModelBtn');
  
  try {
    // Hide the download button
    if (downloadBtn) downloadBtn.style.display = 'none';
    
    // Update UI to show download in progress
    if (statusBadge) {
      statusBadge.className = 'status-badge downloading';
      statusBadge.innerHTML = '<span class="spinner"></span> Downloading...';
    }
    if (statusMessage) {
      statusMessage.textContent = 'Starting download...';
    }
    
    const session = await LanguageModel.create({
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (e) => {
          // e.loaded is a 0–1 fraction
          const percent = Math.round(e.loaded * 100);
          console.log(`Downloading Gemini Nano… ${percent}%`);
          
          // Update UI
          if (statusMessage) {
            statusMessage.textContent = `Downloading model: ${percent}% complete`;
          }
          
          const progressEl = document.getElementById('modelDownloadProgress');
          if (progressEl) {
            progressEl.style.display = 'block';
            progressEl.value = e.loaded;
          }
        });
      }
    });

    console.log("Gemini Nano download complete ✨");

    // Destroy the session since we only wanted to trigger download
    session.destroy();
    
    // Hide progress bar
    const progressEl = document.getElementById('modelDownloadProgress');
    if (progressEl) progressEl.style.display = 'none';
    
    // Re-check availability to update status
    await checkAvailability();
    
  } catch (error) {
    console.error("Error downloading Gemini Nano:", error);
    
    if (statusBadge) {
      statusBadge.className = 'status-badge unavailable';
      statusBadge.textContent = '❌ Download Failed';
    }
    if (statusMessage) {
      statusMessage.textContent = `Error: ${error.message}`;
    }
    // Show download button again
    if (downloadBtn) downloadBtn.style.display = 'block';
  }
}

async function checkAvailability() {
  const statusBadge = document.getElementById('statusBadge');
  const statusMessage = document.getElementById('statusMessage');
  const downloadBtn = document.getElementById('downloadModelBtn');

  try {
    // Hide download button initially
    if (downloadBtn) downloadBtn.style.display = 'none';
    
    // First check if LanguageModel API is available
    if (typeof LanguageModel === 'undefined') {
      statusBadge.className = 'status-badge unavailable';
      statusBadge.innerHTML = '❌ Not Available';
      statusMessage.textContent = 'Chrome AI not available in this browser';
      showErrorOverlay(new Error('LanguageModel API not available'));
      return;
    }
    
    // Check model availability status
    const availability = await LanguageModel.availability();
    console.log('Model availability status:', availability);
    
    // If model is unavailable (crashed), show error overlay immediately
    if (availability === 'unavailable') {
      console.error('💀 Model is unavailable - likely crashed too many times');
      
      statusBadge.className = 'status-badge unavailable';
      statusBadge.innerHTML = '🔄 Restart Required';
      statusMessage.innerHTML = 'Model crashed. <strong>Restart Chrome</strong> to fix.';
      
      try { localStorage.setItem('chrome-ai-restart-required', '1'); } catch { }
      
      const crashError = new Error('PERMANENTLY_DISABLED: Model unavailable. The model has crashed too many times. Restart Chrome to fix.');
      showErrorOverlay(crashError);
      return;
    }
    
    // If model is downloading, show download status (not error)
    if (availability === 'downloading') {
      statusBadge.className = 'status-badge downloading';
      statusBadge.innerHTML = '<span class="spinner"></span> Downloading...';
      statusMessage.textContent = 'Model download in progress... Please wait.';
      
      // Try to initialize to hook into download progress
      try {
        session = await aiSession.ensure();
      } catch (e) {
        // If it fails due to user gesture, show download button
        if (e.message?.includes('user gesture')) {
          statusBadge.innerHTML = '⬇️ Download Required';
          statusMessage.textContent = 'Click the button below to start/resume download';
          if (downloadBtn) downloadBtn.style.display = 'block';
        }
      }
      return;
    }
    
    // If model is downloadable, show download button
    if (availability === 'downloadable') {
      statusBadge.className = 'status-badge unavailable';
      statusBadge.innerHTML = '⬇️ Download Required';
      statusMessage.textContent = 'Click the button below to download the AI model';
      if (downloadBtn) downloadBtn.style.display = 'block';
      return;
    }
    
    statusBadge.className = 'status-badge downloading';
    statusBadge.innerHTML = '<span class="spinner"></span> Checking...';
    statusMessage.textContent = 'Initializing AI model...';

    // Use the self-healing session manager
    try {
      session = await aiSession.ensure();

      try { localStorage.removeItem('chrome-ai-restart-required'); } catch { }
      console.log('✅ AI Model Ready');
      console.log('   Max Tokens:', session.maxTokens || 'N/A');
      console.log('   Tokens Left:', session.tokensLeft || 'N/A');

      statusBadge.className = 'status-badge available';
      statusBadge.textContent = 'Ready';
      statusMessage.textContent = 'AI model is ready to use';

      // Re-enable controls now that the session is healthy
      enableUI();

      initRetryCount = 0;
      return;

    } catch (sessionError) {
      console.error('❌ Session creation failed:', sessionError);

      // Check if download is required (user gesture needed)
      if (sessionError.message?.includes('user gesture') || 
          sessionError.message?.includes('downloadable') ||
          sessionError.message?.includes('downloading')) {
        console.log('⬇️ Model download requires user action');
        
        statusBadge.className = 'status-badge unavailable';
        statusBadge.innerHTML = '⬇️ Download Required';
        statusMessage.textContent = 'Click the button below to download the AI model';
        
        // Show download button (don't show error overlay for this)
        if (downloadBtn) downloadBtn.style.display = 'block';
        
        // Don't show the error overlay for download requirement
        return;
      }

      // Check for crash/restart required error
      if (sessionError.message?.includes('CHROME_RESTART_REQUIRED') ||
        sessionError.message?.includes('crashed too many times')) {
        console.error('💀 Chrome has blocked the model - restart required');

        statusBadge.className = 'status-badge unavailable';
        statusBadge.innerHTML = '🔄 Restart Required';
        statusMessage.innerHTML = 'Model crashed. <strong>Restart Chrome</strong> to fix.';

        try { localStorage.setItem('chrome-ai-restart-required', '1'); } catch { }
        showErrorOverlay(sessionError);
        return;
      }

      // Retry logic for other errors
      if (initRetryCount < MAX_INIT_RETRIES) {
        initRetryCount++;
        console.log(`Retrying in 2s... (Attempt ${initRetryCount}/${MAX_INIT_RETRIES})`);
        statusBadge.className = 'status-badge downloading';
        statusBadge.innerHTML = '<span class="spinner"></span> Retrying...';
        statusMessage.textContent = `Retry attempt ${initRetryCount}/${MAX_INIT_RETRIES}...`;

        setTimeout(() => checkAvailability(), 2000);
        return;
      }

      // Max retries reached
      console.error('❌ Model unavailable after max retries');
      statusBadge.className = 'status-badge unavailable';
      statusBadge.innerHTML = '❌ Unavailable';
      statusMessage.textContent = 'Model could not be initialized';
      showErrorOverlay(sessionError);
      return;
    }

  } catch (error) {
    console.error('❌ Unexpected error in checkAvailability:', error);
    statusBadge.className = 'status-badge unavailable';
    statusBadge.textContent = 'Error';
    statusMessage.textContent = `Error: ${error.message}`;
  }
}

// Initialize the model
async function initializeModel(availability, statusMessage) {
  try {
    if (!session) {
      const temperature = parseFloat(document.getElementById('temperatureSlider').value);
      const topK = parseInt(document.getElementById('topKSlider').value);

      const creationOptions = {
        temperature: temperature,
        topK: topK,
        // Enable multimodal support for images
        // Note: Audio is NOT currently supported by Chrome's Gemini Nano
        // The Prompt API only supports text and image inputs
        expectedInputs: [
          { type: 'text' },
          { type: 'image' }
          // { type: 'audio' } // Not supported - will cause session creation to fail
        ],
        expectedOutputs: [
          { type: 'text', languages: ['en'] }
        ]
      };

      // Add download progress monitor if needed
      if (availability === 'downloadable' || availability === 'downloading') {
        creationOptions.monitor = function (m) {
          m.addEventListener('downloadprogress', e => {
            const percent = ((e.loaded / e.total) * 100).toFixed(0);
            if (statusMessage) {
              statusMessage.textContent = `Downloading: ${percent}% complete`;
            }
            console.log(`Download progress: ${percent}%`);
          });
        };
      }

      console.log('Creating LanguageModel session with multimodal support...');
      session = await LanguageModel.create(creationOptions);
      console.log('✅ Session created successfully with multimodal support');
      console.log(`   Quota: ${session.inputQuota}, Usage: ${session.inputUsage}`);

      // Add quota overflow listener to handle context window overflow
      session.addEventListener('quotaoverflow', () => {
        console.warn('⚠️ Context window overflowed - oldest messages automatically removed by the API');
        const tokenInfo = document.getElementById('tokenInfo');
        if (tokenInfo) {
          tokenInfo.textContent = `⚠️ Context full - old messages removed`;
        }
        // Optionally show a message to the user
        addMessageToUI('assistant', '⚠️ *Context window full. Oldest messages were automatically removed to continue the conversation.*');
      });
    }
  } catch (error) {
    console.error('❌ Error initializing model:', error);
    console.error('   Error name:', error.name);
    console.error('   Error message:', error.message);
    updateStatusUI('unavailable', `Error: ${error.message}`);
    showErrorOverlay(error);
    throw error; // Re-throw so caller knows it failed
  }
}

// Show error overlay
function showErrorOverlay(error) {
  const overlay = document.getElementById('errorOverlay');
  const errorMessage = document.getElementById('errorMessage');
  const errorDetails = document.getElementById('errorDetails');

  let detailsHTML = '';
  const msg = String(error?.message || '');
  const isRestartError = /CHROME_RESTART_REQUIRED|crashed too many times|blocked the model due to previous crashes/i.test(msg);

  if (isRestartError) {
    errorMessage.textContent = '🔄 Chrome Restart Required';
    detailsHTML += `<p>The on‑device model crashed repeatedly and Chrome has temporarily blocked it. To fix:</p>`;
    detailsHTML += `<ol style="margin:6px 0 0 18px">`;
    detailsHTML += `<li><strong>Save work</strong> in other tabs.</li>`;
    detailsHTML += `<li>Type <code>chrome://restart</code> in the address bar and press Enter.</li>`;
    detailsHTML += `<li>Reopen this page; the model will re‑initialize.</li>`;
    detailsHTML += `</ol>`;
  } else {
    errorMessage.textContent = '⚠️ Model initialization failed';
    detailsHTML += `<p><strong>Error:</strong> ${msg}</p>`;
    detailsHTML += `<ul style="margin:6px 0 0 18px">`;
    detailsHTML += `<li>Ensure you are on a recent Chrome version.</li>`;
    detailsHTML += `<li>Check device eligibility and free disk space.</li>`;
    detailsHTML += `<li>Reload this page and try again.</li>`;
    detailsHTML += `</ul>`;
  }

  errorDetails.innerHTML = detailsHTML;
  overlay.classList.add('show');
  disableUI();
}

// Disable UI controls
function disableUI() {
  const controlIds = [
    'promptInput',
    'sendButton',
    'uploadBtn',
    'youtubeBtn',
    'temperatureSlider',
    'topKSlider',
    'streamCheckbox'
  ];

  for (const id of controlIds) {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = true;
    }
  }
}

// Update status UI
function updateStatusUI(status, message) {
  const statusBadge = document.getElementById('statusBadge');
  const statusMessage = document.getElementById('statusMessage');

  statusBadge.className = `status-badge ${status}`;

  const statusTexts = {
    available: '● Ready',
    downloading: '⟳ Downloading',
    unavailable: '● Unavailable'
  };

  statusBadge.textContent = statusTexts[status] || status;
  statusMessage.textContent = message;
}

// Enable UI controls
function enableUI() {
  const controlIds = [
    'promptInput',
    'sendButton',
    'uploadBtn',
    'youtubeBtn',
    'temperatureSlider',
    'topKSlider',
    'streamCheckbox'
  ];

  for (const id of controlIds) {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = false;
    }
  }

  // Clear welcome message
  const chatArea = document.getElementById('chatArea');
  const welcome = chatArea.querySelector('.welcome-message');
  if (welcome) {
    welcome.remove();
  }
}

// Add message to chat
function addMessage(role, content, files = []) {
  const chatArea = document.getElementById('chatArea');
  addMessageToUI(role, content, true, files);

  if (currentChatId) {
    saveMessage(role, content, files).catch(err => {
      console.error('Error saving message:', err);
      // Clear old chats if storage full
      clearOldChats();
    });
  }
}

// Add message to UI only
function addMessageToUI(role, content, isLastMessage = true, files = [], timestamp = null) {
  const chatArea = document.getElementById('chatArea');

  // Remove edit/regenerate buttons from previous last messages
  if (isLastMessage) {
    // Remove edit button from previous last user message
    const allUserMessages = chatArea.querySelectorAll('.message-group.user');
    allUserMessages.forEach(msg => {
      const editBtn = msg.querySelector('.message-btn[title="Edit message"], .message-btn[title="Press Enter to save"]');
      if (editBtn) editBtn.remove();
    });

    // Remove regenerate and edit buttons from previous last assistant message
    const allAssistantMessages = chatArea.querySelectorAll('.message-group.assistant');
    allAssistantMessages.forEach(msg => {
      const regenerateBtn = msg.querySelector('.message-btn[title="Regenerate"]');
      const editPromptBtn = msg.querySelector('.message-btn[title="Edit prompt"]');
      if (regenerateBtn) regenerateBtn.remove();
      if (editPromptBtn) editPromptBtn.remove();
    });
  }

  const messageGroup = document.createElement('div');
  messageGroup.className = `message-group ${role}`;

  const avatar = document.createElement('div');
  avatar.className = `message-avatar ${role}`;
  if (role === 'user') {
    avatar.innerHTML = SVG_ICONS.user;
  } else if (role === 'system') {
    avatar.innerHTML = '⚙️'; // System icon
  }
  // Assistant avatar is hidden via CSS

  const messageContent = document.createElement('div');
  messageContent.className = 'message-content';

  // Render markdown for assistant messages
  if (role === 'assistant') {
    if (typeof marked !== 'undefined') {
      try {
        // Parse markdown and render as HTML
        messageContent.innerHTML = marked.parse(content);
        // Add safety: ensure no script tags
        messageContent.querySelectorAll('script').forEach(el => el.remove());
      } catch (e) {
        console.error('Markdown parsing error:', e);
        messageContent.textContent = content;
      }
    } else {
      messageContent.textContent = content;
    }
  } else {
    messageContent.textContent = content;
  }

  // Add file attachments display for user messages
  if (role === 'user' && files && files.length > 0) {
    const fileAttachments = document.createElement('div');
    fileAttachments.className = 'message-files';
    fileAttachments.style.cssText = 'margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px;';

    files.forEach(f => {
      const fileChip = document.createElement('div');

      // Check if we can open the file (has URL, File, content, or fileData)
      const canOpen = !!(f.fileURL || f.file || f.content || f.fileData);
      const cursorStyle = canOpen ? 'pointer' : 'default';
      const opacity = canOpen ? '1' : '0.6';

      fileChip.style.cssText = `display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: rgba(255,255,255,0.2); border-radius: 12px; font-size: 11px; cursor: ${cursorStyle}; transition: background 0.2s; opacity: ${opacity};`;
      fileChip.innerHTML = `<span>${f.icon || '📄'}</span><span>${f.name}</span>`;

      // Show file path in tooltip
      const filePath = f.path || f.name;
      if (canOpen) {
        fileChip.title = `Path: ${filePath}\nClick to open`;
      } else {
        fileChip.title = `Path: ${filePath}\n(File reference only - content not available after reload)`;
      }

      // Make file chip clickable to open the file
      if (canOpen) {
        fileChip.onclick = () => {
          if (f.fileURL) {
            // Use preserved blob URL directly (current session)
            window.open(f.fileURL, '_blank');
          } else if (f.file) {
            // For image/audio files, create blob URL and open (current session)
            const fileURL = URL.createObjectURL(f.file);
            window.open(fileURL, '_blank');
          } else if (f.fileData) {
            // Recreate file from base64 data (restored from database)
            // Convert base64 to blob
            const byteString = atob(f.fileData.split(',')[1]);
            const mimeString = f.fileData.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: mimeString });
            const fileURL = URL.createObjectURL(blob);
            window.open(fileURL, '_blank');
          } else if (f.content) {
            // For text files, create a blob from content and open
            const blob = new Blob([f.content], { type: 'text/plain' });
            const fileURL = URL.createObjectURL(blob);
            window.open(fileURL, '_blank');
          }
        };

        // Hover effect only for openable files
        fileChip.onmouseenter = () => {
          fileChip.style.background = 'rgba(255,255,255,0.3)';
        };
        fileChip.onmouseleave = () => {
          fileChip.style.background = 'rgba(255,255,255,0.2)';
        };
      }

      fileAttachments.appendChild(fileChip);
    });

    messageContent.appendChild(fileAttachments);
  }

  // Add timestamp
  const timestampEl = document.createElement('div');
  timestampEl.className = 'message-timestamp';
  timestampEl.style.cssText = 'font-size: 10px; color: #888; margin-top: 4px; opacity: 0.7;';
  const messageTime = timestamp ? new Date(timestamp) : new Date();
  const timeString = messageTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  timestampEl.textContent = timeString;
  messageContent.appendChild(timestampEl);

  const messageActions = document.createElement('div');
  messageActions.className = 'message-actions';

  // Copy button - appears on ALL messages
  const copyBtn = document.createElement('button');
  copyBtn.className = 'message-btn';
  copyBtn.innerHTML = SVG_ICONS.copy;
  copyBtn.title = 'Copy';
  copyBtn.onclick = () => navigator.clipboard.writeText(content);

  messageActions.appendChild(copyBtn);

  // Edit button - only on LAST user message
  if (role === 'user' && isLastMessage) {
    const editUserBtn = document.createElement('button');
    editUserBtn.className = 'message-btn';
    editUserBtn.innerHTML = SVG_ICONS.edit;
    editUserBtn.title = 'Edit message';

    // Function to save and regenerate
    const saveAndRegenerate = () => {
      const editedText = messageContent.textContent.trim();

      if (!editedText) {
        alert('Message cannot be empty');
        return;
      }

      // Exit edit mode
      messageContent.contentEditable = 'false';
      messageContent.style.border = 'none';
      messageContent.style.padding = '16px';
      editUserBtn.innerHTML = SVG_ICONS.edit;
      editUserBtn.title = 'Edit message';

      // Remove keydown listener
      messageContent.removeEventListener('keydown', handleEnterKey);

      // Update the last user prompt
      lastUserPrompt = editedText;

      // Remove all messages after this one
      let nextSibling = messageGroup.nextElementSibling;
      while (nextSibling) {
        const toRemove = nextSibling;
        nextSibling = nextSibling.nextElementSibling;
        toRemove.remove();
      }

      // Regenerate the response with the edited message
      regenerateLastResponse();
    };

    // Handle Enter key in edit mode
    const handleEnterKey = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveAndRegenerate();
      }
    };

    editUserBtn.onclick = () => {
      // Make the message content editable
      const isCurrentlyEditing = messageContent.contentEditable === 'true';

      if (!isCurrentlyEditing) {
        // Enter edit mode
        messageContent.contentEditable = 'true';
        messageContent.focus();
        messageContent.style.border = '2px solid #10a37f';
        messageContent.style.padding = '16px';
        messageContent.style.borderRadius = '8px';
        editUserBtn.textContent = '💾';
        editUserBtn.title = 'Press Enter to save';

        // Add Enter key listener
        messageContent.addEventListener('keydown', handleEnterKey);

        // Place cursor at the end
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(messageContent);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        // Save mode - clicking button also saves
        saveAndRegenerate();
      }
    };
    messageActions.appendChild(editUserBtn);
  }

  // Regenerate and Edit buttons - only on LAST assistant message
  if (role === 'assistant' && isLastMessage) {
    const regenerateBtn = document.createElement('button');
    regenerateBtn.className = 'message-btn';
    regenerateBtn.innerHTML = SVG_ICONS.regenerate;
    regenerateBtn.title = 'Regenerate';
    regenerateBtn.onclick = async () => {
      if (!lastUserPrompt) {
        console.warn('No previous prompt to regenerate from');
        return;
      }
      // Remove this assistant message
      messageGroup.remove();
      // Regenerate response
      await regenerateLastResponse();
    };
    messageActions.appendChild(regenerateBtn);

    const editBtn = document.createElement('button');
    editBtn.className = 'message-btn';
    editBtn.innerHTML = SVG_ICONS.edit;
    editBtn.title = 'Edit prompt';
    editBtn.onclick = () => {
      if (!lastUserPrompt) {
        console.warn('No previous prompt to edit');
        return;
      }
      // Populate input with last prompt for editing
      const promptInput = document.getElementById('promptInput');
      promptInput.value = lastUserPrompt;
      promptInput.focus();
      // Auto-resize textarea
      promptInput.style.height = 'auto';
      promptInput.style.height = promptInput.scrollHeight + 'px';
    };
    messageActions.appendChild(editBtn);
  }

  // Only append avatar for user messages (assistant avatar is not shown)
  if (role === 'user') {
    messageGroup.appendChild(avatar);
  }
  messageGroup.appendChild(messageContent);
  messageGroup.appendChild(messageActions);

  chatArea.appendChild(messageGroup);
  chatArea.scrollTop = chatArea.scrollHeight;
}

// Sanitize and simplify content for Gemini Nano compatibility
function sanitizePromptContent(content) {
  // AGGRESSIVE sanitization - remove almost everything that might cause crashes
  let sanitized = content
    // Replace multiple newlines with single newline
    .replace(/\n\n+/g, '\n')
    // Remove markdown formatting
    .replace(/[*_`~]/g, '')
    // Remove all special characters except basic punctuation
    .replace(/[^\w\s\.\,\!\?\'\"\-\(\)\n]/g, ' ')
    // Remove excessive spaces
    .replace(/  +/g, ' ')
    // Remove control characters and null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Trim whitespace
    .trim();

  // If result is empty or too different, return a safe message
  if (!sanitized || sanitized.length < 10) {
    return '[File content could not be processed safely]';
  }

  return sanitized;
}

// Proactive session health check and auto-recovery
async function ensureSessionHealth() {
  console.log('🏥 Checking session health...');

  // Check if session exists
  if (!session) {
    console.warn('⚠️ No session exists - creating new one');
    await checkAvailability();
    return session !== null;
  }

  // Quick check: is session destroyed?
  try {
    if (session.destroyed) {
      console.warn('⚠️ Session is destroyed - recreating');
      session = null;
      await checkAvailability();
      return session !== null;
    }

    // Fast check: does session have expected properties?
    if (!session.prompt || typeof session.prompt !== 'function') {
      throw new Error('Session missing prompt method');
    }

    // Session looks healthy - skip expensive test
    console.log('✅ Session is healthy (quick check)');
    return true;

  } catch (quickCheckError) {
    console.warn('⚠️ Quick health check failed:', quickCheckError.message);

    // Only do expensive test if quick check failed
    try {
      // Test if we can measure a simple prompt
      await session.measureInputUsage('test');
      console.log('✅ Session is healthy (verified)');
      return true;
    } catch (testError) {
      console.error('❌ Session health check failed:', testError.message);

      // If session is broken, try to recreate it
      if (testError.message.includes('crashed') || testError.message.includes('destroyed')) {
        console.log('🔄 Attempting to recreate session...');
        try {
          if (session) session.destroy();
        } catch (e) {
          // Ignore destroy errors
        }

        session = null;
        await checkAvailability();
        return session !== null;
      }

      return false;
    }
  }
}

// Truncate content to fit within context window while preserving file content
async function truncateContentToFitContext(content, maxTokens) {
  // More accurate estimate: ~2.8 characters per token for mixed content
  const maxChars = Math.floor(maxTokens * 2.8);

  console.log(`📊 Token management - Max tokens: ${maxTokens}, Max chars: ${maxChars}, Current length: ${content.length}`);

  if (content.length <= maxChars) {
    console.log(`✓ Content fits within token limit`);
    return content;
  }

  console.warn(`⚠️ Content exceeds limit by ${content.length - maxChars} characters`);

  // Split prompt from files
  const parts = content.split('--- Attached Files ---');

  if (parts.length === 1) {
    // No files, truncate prompt intelligently
    const truncated = content.substring(0, maxChars);
    console.log(`Truncated prompt-only from ${content.length} to ${truncated.length} chars`);
    return truncated + '\n\n[⚠️ Content was truncated due to token limits]';
  }

  const prompt = parts[0];
  const fileSection = parts[1] || '';

  // Strategy: Preserve prompt, truncate files proportionally
  const promptOverhead = prompt.length + 100; // Buffer for markers
  let availableCharsForFiles = maxChars - promptOverhead;

  console.log(`Prompt: ${prompt.length} chars, Available for files: ${availableCharsForFiles} chars`);

  if (availableCharsForFiles < 500) {
    // If space is very limited, try removing the user's message prefix to save space
    console.warn(`⚠️ Limited space available - compressing format`);
    availableCharsForFiles = maxChars - 50;
  }

  // Intelligently truncate file content while keeping file structure
  const fileLines = fileSection.split('[File: ');
  let truncatedFiles = '';

  for (const filePart of fileLines) {
    if (!filePart) continue;

    const truncatedFiles_newLength = truncatedFiles.length + filePart.length + 8; // +8 for '[File: '

    if (truncatedFiles_newLength <= availableCharsForFiles) {
      // File fits completely
      truncatedFiles += (truncatedFiles ? '[File: ' : '') + filePart;
    } else {
      // File doesn't fit completely, truncate it
      const remainingSpace = availableCharsForFiles - truncatedFiles.length - 8;
      if (remainingSpace > 200) {
        // At least show partial file content
        const partial = filePart.substring(0, remainingSpace);
        truncatedFiles += '[File: ' + partial + '\n[... truncated ...]';
        console.log(`Partially included file: kept ${partial.length} chars`);
      }
      break; // Stop adding more files
    }
  }

  const result = prompt + '--- Attached Files ---\n' + truncatedFiles + '\n\n[⚠️ Files were truncated to fit token limits. Content is preserved but may be partial.]';
  console.log(`Final content: ${result.length} chars (reduced from ${content.length})`);
  return result;
}

// Send message
async function sendMessage() {
  const promptInput = document.getElementById('promptInput');
  const sendButton = document.getElementById('sendButton');
  const prompt = promptInput.value.trim();

  if (!prompt && Object.keys(uploadedFiles).length === 0) return;

  // Check if files are still being processed
  if (!areFilesReady()) {
    addMessage('assistant', 'Please wait for all files to finish processing before sending.');
    return;
  }

  // PROACTIVE: Check session health BEFORE attempting to send
  console.log('🏥 Running pre-send health check...');
  const isHealthy = await ensureSessionHealth();

  if (!isHealthy) {
    console.error('❌ Session health check failed - cannot send message');
    addMessage('assistant', '⚠️ The AI session is unhealthy and needs to be restarted. Please go to chrome://restart to fix this.');
    return;
  }

  console.log('✅ Session health check passed - proceeding with message');

  // Check if session exists and is valid
  if (!session) {
    addMessage('assistant', 'The AI model is not initialized. Initializing now...');
    await checkAvailability();
    return;
  }

  // Try to verify session is still alive
  try {
    // Test if session is still valid by checking a property
    if (session.destroyed || !session.prompt) {
      console.warn('⚠️ Session appears to be destroyed. Recreating...');
      throw new Error('Session destroyed');
    }
  } catch (sessionError) {
    console.error('❌ Session is invalid:', sessionError);
    addMessage('assistant', 'The AI session has expired. Reinitializing the model...');
    session = null; // Clear invalid session
    await checkAvailability(); // Reinitialize

    // After reinitialization, try sending again
    setTimeout(() => {
      addMessage('assistant', 'Model reinitialized! Please send your message again.');
    }, 1000);
    return;
  }

  // Create chat if needed - use generated title from first message or "Files uploaded"
  if (!currentChatId) {
    const chatTitle = prompt ? generateChatTitle(prompt) : 'Files uploaded';
    await saveChat(chatTitle);
  }

  // Build prompt with files content
  let userTextOnly = prompt; // Only the user's typed text (for display and editing)
  let fullUserMessage = prompt; // Full message to send to AI (includes file content)
  let hasMultimodalFiles = false;
  let multimodalContent = [];

  // Add file contents if any
  const successfulFiles = Object.values(uploadedFiles).filter(f => f.status === 'success');

  // Create a copy of files to preserve for display in chat (before clearing widget)
  const filesForDisplay = successfulFiles.map(f => ({
    name: f.name,
    path: f.path || f.name, // Preserve file path reference
    icon: f.icon,
    type: f.type,
    file: f.file, // Preserve File object (temporary, for current session)
    content: f.content, // Preserve text content
    fileData: f.fileData, // Preserve base64 data for images/audio
    fileURL: f.fileURL, // Preserve blob URL (temporary, for current session)
    imageInfo: f.imageInfo, // Preserve image metadata
    audioInfo: f.audioInfo // Preserve audio metadata
  }));

  if (successfulFiles.length > 0) {
    console.log(`✓ ${successfulFiles.length} file(s) uploaded - including content`);

    // Check if we have image files (multimodal)
    // Note: Audio is NOT supported by Gemini Nano
    const imageFiles = successfulFiles.filter(f => f.file && f.type.startsWith('image/'));
    const audioFiles = successfulFiles.filter(f => f.file && f.type.startsWith('audio/'));
    const textFiles = successfulFiles.filter(f => !f.file); // Text-based files

    // Warn user if they uploaded audio files (not supported)
    if (audioFiles.length > 0) {
      console.warn(`⚠️ ${audioFiles.length} audio file(s) uploaded but will be IGNORED - audio not supported by Gemini Nano`);
    }

    if (imageFiles.length > 0) {
      hasMultimodalFiles = true;

      // Build multimodal content array
      // Start with the text prompt
      if (prompt && prompt.trim()) {
        multimodalContent.push({ type: 'text', value: prompt });
      }

      // Add image files
      imageFiles.forEach(f => {
        multimodalContent.push({ type: 'image', value: f.file });
      });

      // ❌ Audio files are NOT sent to AI (not supported)
      // audioFiles are shown in UI but ignored in the prompt

      // Add text file contents as additional context (hidden from display)
      if (textFiles.length > 0) {
        let textContext = '\n\n--- Additional Files ---\n';
        textFiles.forEach(f => {
          textContext += `\n[File: ${f.name}]\n${f.content}\n`;
        });
        multimodalContent.push({ type: 'text', value: textContext });
      }

      // Don't add file context to display message - keep it clean

    } else {
      // All text files - add content to AI prompt but NOT to display
      let fileContext = '\n\n--- Attached Files ---\n';
      successfulFiles.forEach(f => {
        fileContext += `\n[File: ${f.name}]\n${f.content}\n`;
      });
      fullUserMessage += fileContext; // Send to AI
      // userTextOnly remains just the prompt (for display)
    }

    console.log(`📊 Total message size: ${fullUserMessage.length} characters`);
  }

  // Add user message - display only user's text, not file content
  addMessage('user', userTextOnly, filesForDisplay);
  promptInput.value = '';
  promptInput.style.height = 'auto';

  // Store only the user's typed text for regeneration (not file content)
  lastUserPrompt = userTextOnly;

  // Clear file widget after sending message
  clearFileWidget();

  sendButton.disabled = true;

  // Create AbortController for stopping generation
  const abortController = new AbortController();
  let isGenerating = true;

  // Change send button to stop button during generation
  const originalButtonHTML = sendButton.innerHTML;
  sendButton.innerHTML = SVG_ICONS.stop;
  sendButton.disabled = false;
  sendButton.onclick = () => {
    if (isGenerating) {
      abortController.abort();
      console.log('Generation stopped by user');
    }
  };

  let finalPrompt = ''; // Declare outside try block so catch can access it
  let fullText = ''; // Declare outside try block for abort error handling

  try {
    // Build the prompt with conversation context if available
    // When switching chats, the session is reset, so we need to provide context
    let conversationContext = '';

    // Include previous messages as context if this is a resumed chat
    // Limit to recent messages to avoid token overflow
    if (messageHistory.length > 1) {
      // Calculate how many messages we can include based on quota
      const quota = session.inputQuota || 9216;
      const maxContextTokens = Math.floor(quota * 0.3); // Use max 30% for context

      // Build context from recent messages (excluding the current user message we just added)
      const recentMessages = messageHistory.slice(-10, -1); // Get last 10 messages (excluding current)

      if (recentMessages.length > 0) {
        conversationContext = '\n\n[Previous conversation context for reference:\n';
        for (const msg of recentMessages) {
          const role = msg.role === 'user' ? 'User' : 'Assistant';
          // Truncate very long messages
          const content = msg.content.length > 500 ? msg.content.substring(0, 500) + '...' : msg.content;
          conversationContext += `${role}: ${content}\n`;
        }
        conversationContext += ']\n\nUser (current message): ';
      }
    }

    // The Chrome AI Prompt API automatically maintains conversation context within a session.
    // When we switch chats, the session is reset, so we provide context manually.
    finalPrompt = conversationContext + fullUserMessage;

    // Add word limit instruction if enabled
    if (wordLimitEnabled && maxResponseWords > 0) {
      finalPrompt = finalPrompt + `\n\n[SYSTEM INSTRUCTION: Please limit your response to approximately ${maxResponseWords} words maximum. Be concise.]`;
    }

    console.log(`📤 Sending prompt (${finalPrompt.length} chars). Session has ${messageHistory.length} previous messages in context.`);
    if (messageHistory.length > 0) {
      console.log(`💡 Including context from ${Math.min(10, messageHistory.length - 1)} recent message(s)`);
    }

    // First, verify session is still valid
    if (!session || session.destroyed) {
      console.error('❌ Session is invalid or destroyed before sending message');
      addMessage('assistant', 'The AI session has expired. Please reload the page and try again.');
      sendButton.innerHTML = originalButtonHTML;
      sendButton.disabled = false;
      sendButton.onclick = sendMessage;
      return;
    }

    // Check token usage before sending
    let tokenCost = 0;
    const tokenInfo = document.getElementById('tokenInfo');

    try {
      // Verify session is still valid before measuring
      if (session && !session.destroyed && session.prompt) {
        tokenCost = await session.measureInputUsage(finalPrompt);
        console.log(`✓ Measured token cost: ${tokenCost} tokens`);
      } else {
        console.warn('⚠️ Session invalid, cannot measure tokens. Estimating...');
        // Rough estimate: ~4 chars per token
        tokenCost = Math.ceil(finalPrompt.length / 4);
      }
    } catch (tokenError) {
      console.warn('Could not measure token usage:', tokenError.message || tokenError);
      // Fallback: estimate tokens based on character count
      tokenCost = Math.ceil(finalPrompt.length / 4);
      console.log(`📊 Estimated token cost: ~${tokenCost} tokens (based on character count)`);
    }

    // Get ACTUAL quota info from API
    const used = session.inputUsage || 0;
    const quota = session.inputQuota || 30000; // Fallback to ~30K for Gemini Nano
    const totalTokens = used + tokenCost;

    console.log(`📊 Token Report - Used: ${used}, New cost: ${tokenCost}, Total: ${totalTokens}, Quota: ${quota}`);

    // AUTO-TRIM: If context is getting too full (>75%), reset session with fresh context
    if (quota !== Infinity && totalTokens > quota * 0.75) {
      console.warn(`⚠️ Context window is ${Math.round((totalTokens / quota) * 100)}% full (${totalTokens}/${quota} tokens)`);
      console.log(`🔄 Auto-trimming conversation history to prevent overflow...`);

      try {
        // Reset the aiSession (destroys old session and allows fresh one to be created)
        await aiSession.reset();

        // Get the new session
        session = await aiSession.ensure();

        console.log(`✓ Fresh session created. New quota: ${session.inputQuota} tokens`);
        console.log(`📝 Conversation history cleared. Starting with current message only.`);

        // Clear message history since we have a fresh session
        messageHistory = [];

        // Update token display
        if (tokenInfo) {
          tokenInfo.textContent = `🟢 Tokens: ${tokenCost} / ${session.inputQuota} (Reset)`;
        }

        // Show user that context was reset
        addMessage('system', '💡 Conversation history was reset to free up context space. Previous messages are still visible but the AI won\'t remember them.');

      } catch (resetError) {
        console.error('Failed to reset session:', resetError);
        // Continue with current session
      }
    } else if (tokenInfo) {
      if (totalTokens > quota * 0.9) {
        tokenInfo.textContent = `🔴 Tokens: ${totalTokens} / ${quota} (WARNING: 90% full)`;
      } else if (totalTokens > quota * 0.7) {
        tokenInfo.textContent = `🟡 Tokens: ${totalTokens} / ${quota} (Approaching limit)`;
      } else {
        tokenInfo.textContent = `🟢 Tokens: ${totalTokens} / ${quota}`;
      }
    }

    // SMART check: If current message is too large, truncate it
    if (quota !== Infinity && tokenCost > quota * 0.5) {
      console.warn(`⚠️ Single message is very large: ${tokenCost} tokens (${Math.round((tokenCost / quota) * 100)}% of quota)`);

      // Calculate max tokens for this message (aim for 40% of quota max)
      const safeMaxTokens = Math.floor(quota * 0.40);
      console.log(`📉 Truncating message to ${safeMaxTokens} tokens`);

      // Truncate file content to fit within safe limits
      let truncatedPrompt = await truncateContentToFitContext(fullUserMessage, safeMaxTokens);

      try {
        const newTokenCost = await session.measureInputUsage(truncatedPrompt);
        console.log(`✓ After optimization: ${newTokenCost} tokens (${Math.round((newTokenCost / quota) * 100)}% of quota)`);
        finalPrompt = truncatedPrompt; // Use truncated version

        if (tokenInfo) {
          const newTotal = used + newTokenCost;
          if (newTotal > quota * 0.9) {
            tokenInfo.textContent = `🟡 Tokens: ${newTotal} / ${quota} (Still near limit)`;
          } else if (newTotal > quota * 0.8) {
            tokenInfo.textContent = `🟡 Tokens: ${newTotal} / ${quota} (Optimized)`;
          } else {
            tokenInfo.textContent = `🟢 Tokens: ${newTotal} / ${quota} ✓ Optimized`;
          }
        }
      } catch (e) {
        console.warn('Could not measure optimized token usage:', e);
      }
      finalPrompt = truncatedPrompt;
    }

    const useStream = document.getElementById('streamCheckbox').checked;
    console.log('🎬 Starting prompt execution. Streaming:', useStream, '| Multimodal:', hasMultimodalFiles);
    // fullText already declared outside try block

    const chatArea = document.getElementById('chatArea');
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group assistant';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar assistant';
    // Assistant avatar is hidden via CSS

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.innerHTML = '<span class="spinner"></span> Thinking...';

    // Don't append avatar for assistant messages (cleaner look)
    messageGroup.appendChild(messageContent);
    chatArea.appendChild(messageGroup);
    chatArea.scrollTop = chatArea.scrollHeight;

    if (useStream) {
      messageContent.innerHTML = '';
      let stream;

      // Use self-healing session manager with streaming
      if (hasMultimodalFiles && multimodalContent.length > 0) {
        console.log('📸 Using multimodal streaming prompt with', multimodalContent.length, 'parts');
        stream = await aiSession.prompt([{
          role: 'user',
          content: multimodalContent
        }], { stream: true, signal: abortController.signal });
      } else {
        // Traditional text-only prompt
        console.log('📝 Using text-only streaming prompt');
        stream = await aiSession.prompt(finalPrompt, { stream: true, signal: abortController.signal });
      }
      console.log('🌊 Stream created, beginning iteration...');

      for await (const chunk of stream) {
        // Check if abort was requested
        if (abortController.signal.aborted) {
          console.log('Stream aborted - breaking loop');
          break;
        }

        fullText += chunk;

        // Check word limit if enabled
        if (wordLimitEnabled) {
          const wordCount = fullText.trim().split(/\s+/).length;
          if (wordCount > maxResponseWords) {
            // Truncate to word limit
            const words = fullText.trim().split(/\s+/);
            fullText = words.slice(0, maxResponseWords).join(' ');
            messageContent.innerHTML = marked.parse(fullText + '\n\n*[truncated to ' + maxResponseWords + ' words]*');
            break;
          }
        }

        // Render markdown as it streams
        if (typeof marked !== 'undefined') {
          try {
            messageContent.innerHTML = marked.parse(fullText);
          } catch (e) {
            messageContent.textContent = fullText;
          }
        } else {
          messageContent.textContent = fullText;
        }

        // Auto-scroll only if user is already near the bottom (within 100px)
        const isNearBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 100;
        if (isNearBottom) {
          chatArea.scrollTop = chatArea.scrollHeight;
        }
      }
      console.log('✅ Streaming complete. Total text:', fullText.length, 'chars');
    } else {
      console.log('📦 Using non-streaming prompt');
      // Use self-healing session manager
      if (hasMultimodalFiles && multimodalContent.length > 0) {
        console.log('📸 Using multimodal prompt (non-streaming) with', multimodalContent.length, 'parts');
        fullText = await aiSession.prompt([{
          role: 'user',
          content: multimodalContent
        }], { signal: abortController.signal });
      } else {
        // Traditional text-only prompt
        console.log('📝 Using text-only non-streaming prompt');
        fullText = await aiSession.prompt(finalPrompt, { signal: abortController.signal });
      }
      console.log('✅ Non-streaming prompt complete. Response:', fullText?.substring(0, 100));

      // Apply word limit if enabled
      if (wordLimitEnabled && fullText) {
        const words = fullText.trim().split(/\s+/);
        if (words.length > maxResponseWords) {
          fullText = words.slice(0, maxResponseWords).join(' ') + '\n\n*[truncated to ' + maxResponseWords + ' words]*';
        }
      }

      // Render markdown in response
      if (typeof marked !== 'undefined') {
        try {
          messageContent.innerHTML = marked.parse(fullText);
        } catch (e) {
          messageContent.textContent = fullText;
        }
      } else {
        messageContent.textContent = fullText;
      }
    }

    // Save assistant message
    await saveMessage('assistant', fullText);
    console.log('Generated text:', fullText);
  } catch (error) {
    const chatArea = document.getElementById('chatArea');

    // Check if it's an AbortError first (user clicked stop)
    if (error.name === 'AbortError') {
      console.log('⏹ Generation stopped by user');

      // Save the partial message that was streamed
      if (fullText && fullText.trim()) {
        await saveMessage('assistant', fullText);
        console.log('💾 Saved partial response:', fullText.length, 'characters');

        // Add visual indicator that this was a partial response
        const messageContent = chatArea.lastElementChild?.querySelector('.message-content');
        if (messageContent && !messageContent.innerHTML.includes('stopped')) {
          const currentContent = messageContent.innerHTML;
          messageContent.innerHTML = currentContent + '\n\n<em style="color: #888; font-size: 0.9em;">⏹ Generation stopped</em>';
        }
      } else {
        console.log('⏹ Generation stopped (no content to save)');
      }

      return;
    }

    // Log detailed error info for non-abort errors
    console.error('❌ Full error object:', error);
    console.error('   Error name:', error.name);
    console.error('   Error message:', error.message);
    if (error.stack) console.error('   Error stack:', error.stack);
    if (finalPrompt) {
      console.error('   Prompt length:', finalPrompt.length);
      console.error('   Prompt preview:', finalPrompt.substring(0, 200));
    }

    // Strategy 0: Check if session was destroyed
    const errorMsg = error.message?.toLowerCase() || '';

    if (errorMsg.includes('session has been destroyed') || errorMsg.includes('invalidstateerror')) {
      console.error('💀 Session destroyed - clearing and reinitializing');

      const messageContent = chatArea.lastElementChild?.querySelector('.message-content');
      if (messageContent) {
        messageContent.innerHTML = `
          <div style="color: var(--error-color); padding: 10px; border-left: 3px solid var(--error-color);">
            ⚠️ The AI session expired. Reinitializing the model...
            <br><small>Please try sending your message again in a moment.</small>
          </div>
        `;
      }

      // Clear the destroyed session and reinitialize
      session = null;
      await checkAvailability();

      sendButton.disabled = false;
      return;
    }

    // Strategy 1: Check if it's a known Chrome Prompt API error

    if (errorMsg.includes('generic') || errorMsg.includes('failure') || errorMsg.includes('crashed') || errorMsg.includes('unknown')) {
      console.error('💥 Model has crashed or failed - need to recreate session');

      const messageContent = chatArea.lastElementChild?.querySelector('.message-content');

      // Destroy the broken session
      try {
        if (session && session.destroy) {
          session.destroy();
        }
      } catch (destroyError) {
        console.warn('Could not destroy session:', destroyError);
      }
      session = null;

      if (messageContent) {
        messageContent.innerHTML = `
          <div style="color: var(--error-color); padding: 10px; border-left: 3px solid var(--error-color);">
            ⚠️ The AI model has crashed. Reinitializing...
            <br><small>Please wait a moment and try again.</small>
          </div>
        `;
      }

      // Recreate the session
      console.log('🔄 Recreating AI session...');
      await checkAvailability();

      if (!session) {
        console.error('❌ Could not recreate session');
        if (messageContent) {
          messageContent.innerHTML = `
            <div style="color: var(--error-color); padding: 10px; border-left: 3px solid var(--error-color);">
              ❌ Failed to recreate AI session. Please reload the page.
            </div>
          `;
        }
        sendButton.disabled = false;
        return;
      }

      console.log('✅ Session recreated successfully');

      // Now try the prompt again with the new session
      if (prompt && prompt.trim()) {
        try {
          console.log('🔄 Retrying with new session...');
          const retryText = await session.prompt(prompt.trim());

          if (messageContent) {
            if (typeof marked !== 'undefined') {
              try {
                messageContent.innerHTML = marked.parse(retryText);
              } catch (e) {
                messageContent.textContent = retryText;
              }
            } else {
              messageContent.textContent = retryText;
            }
          }

          await saveMessage('assistant', retryText);
          console.log('✅ Retry successful with new session');
          sendButton.disabled = false;
          return;

        } catch (retryError) {
          console.error('❌ Retry failed even with new session:', retryError);
          if (messageContent) {
            messageContent.innerHTML = `
              <div style="color: var(--error-color); padding: 10px; border-left: 3px solid var(--error-color);">
                ❌ AI is unavailable. Please reload the page or restart Chrome.
              </div>
            `;
          }
        }
      }

      sendButton.disabled = false;
      return;
    }

    // Strategy 2: Check for quota/context errors
    if (errorMsg.includes('quota') || errorMsg.includes('context')) {
      console.warn('⚠️ Quota/Context error detected, attempting retry with smaller content');

      // Try again with much smaller content (50% of quota max)
      if (session) {
        try {
          const safeMaxTokens = Math.floor(session.inputQuota * 0.5);
          const smallerPrompt = await truncateContentToFitContext(fullUserMessage, safeMaxTokens);
          console.log(`🔄 Retrying with ${smallerPrompt.length} chars (~${Math.floor(smallerPrompt.length / 2.5)} tokens)`);

          const smallerText = await session.prompt(smallerPrompt);

          const messageContent = chatArea.lastElementChild?.querySelector('.message-content');
          if (messageContent) {
            if (typeof marked !== 'undefined') {
              try {
                messageContent.innerHTML = marked.parse(smallerText);
              } catch (e) {
                messageContent.textContent = smallerText;
              }
            } else {
              messageContent.textContent = smallerText;
            }
          }

          await saveMessage('assistant', smallerText);
          console.log('✅ Retry successful!');
          return;
        } catch (retryError) {
          console.error('Quota retry failed:', retryError);
        }
      }
    }

    if (error.name !== 'AbortError') {
      const helpText = errorMsg.includes('generic') || errorMsg.includes('crashed')
        ? '❌ The model crashed. This is a Chrome Prompt API issue. Try: 1) Refresh page, 2) Check chrome://flags/#prompt-api-for-gemini-nano, 3) Use simpler prompts without files.'
        : errorMsg.includes('quota') || errorMsg.includes('context')
          ? '❌ Context window exceeded. Try with shorter content or fewer files.'
          : '❌ Unknown error occurred. Please try again with a different prompt.';

      addMessage('assistant', helpText);
    }
    console.error('Error generating text:', error);
  } finally {
    isGenerating = false;
    sendButton.innerHTML = SVG_ICONS.send;
    sendButton.disabled = false;
    sendButton.onclick = sendMessage;
  }
}

// Regenerate last response
async function regenerateLastResponse() {
  if (!lastUserPrompt || !session) {
    console.warn('Cannot regenerate: no previous prompt or session');
    return;
  }

  const sendButton = document.getElementById('sendButton');
  const abortController = new AbortController();
  let isGenerating = true;
  let fullText = ''; // Declare outside try block for error handling

  sendButton.innerHTML = SVG_ICONS.stop;
  sendButton.disabled = false;
  sendButton.onclick = () => {
    if (isGenerating) {
      abortController.abort();
      console.log('Regeneration stopped by user');
    }
  };

  try {
    const chatArea = document.getElementById('chatArea');
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group assistant';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar assistant';
    // Assistant avatar is hidden via CSS

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.innerHTML = '<span class="spinner"></span> Regenerating...';

    // Don't append avatar for assistant messages (cleaner look)
    messageGroup.appendChild(messageContent);
    chatArea.appendChild(messageGroup);
    chatArea.scrollTop = chatArea.scrollHeight;

    // Prepare the prompt with word limit instruction if enabled
    let promptToSend = lastUserPrompt;
    if (wordLimitEnabled && maxResponseWords > 0) {
      promptToSend = lastUserPrompt + `\n\n[SYSTEM INSTRUCTION: Please limit your response to approximately ${maxResponseWords} words maximum. Be concise.]`;
    }

    const useStream = document.getElementById('streamCheckbox').checked;

    if (useStream) {
      messageContent.innerHTML = '';
      const stream = await session.promptStreaming(promptToSend, { signal: abortController.signal });
      for await (const chunk of stream) {
        // Check if abort was requested
        if (abortController.signal.aborted) {
          console.log('Regeneration stream aborted - breaking loop');
          break;
        }

        fullText += chunk;

        // Check word limit if enabled
        if (wordLimitEnabled && maxResponseWords > 0) {
          const wordCount = fullText.trim().split(/\s+/).length;
          if (wordCount > maxResponseWords) {
            const words = fullText.trim().split(/\s+/);
            fullText = words.slice(0, maxResponseWords).join(' ');
            messageContent.innerHTML = marked.parse(fullText + '\n\n*[truncated to ' + maxResponseWords + ' words]*');
            break;
          }
        }

        // Render markdown for streaming
        if (typeof marked !== 'undefined') {
          try {
            messageContent.innerHTML = marked.parse(fullText);
          } catch (e) {
            messageContent.textContent = fullText;
          }
        } else {
          messageContent.textContent = fullText;
        }
        chatArea.scrollTop = chatArea.scrollHeight;
      }
    } else {
      fullText = await session.prompt(promptToSend, { signal: abortController.signal });

      // Apply word limit if enabled
      if (wordLimitEnabled && fullText) {
        const words = fullText.trim().split(/\s+/);
        if (words.length > maxResponseWords) {
          fullText = words.slice(0, maxResponseWords).join(' ') + '\n\n*[truncated to ' + maxResponseWords + ' words]*';
        }
      }

      // Render markdown in response
      if (typeof marked !== 'undefined') {
        try {
          messageContent.innerHTML = marked.parse(fullText);
        } catch (e) {
          messageContent.textContent = fullText;
        }
      } else {
        messageContent.textContent = fullText;
      }
    }

    // Add action buttons to the new message
    const messageActions = document.createElement('div');
    messageActions.className = 'message-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'message-btn';
    copyBtn.innerHTML = SVG_ICONS.copy;
    copyBtn.title = 'Copy';
    copyBtn.onclick = () => navigator.clipboard.writeText(fullText);
    messageActions.appendChild(copyBtn);

    const regenerateBtn = document.createElement('button');
    regenerateBtn.className = 'message-btn';
    regenerateBtn.innerHTML = SVG_ICONS.regenerate;
    regenerateBtn.title = 'Regenerate';
    regenerateBtn.onclick = async () => {
      messageGroup.remove();
      await regenerateLastResponse();
    };
    messageActions.appendChild(regenerateBtn);

    const editBtn = document.createElement('button');
    editBtn.className = 'message-btn';
    editBtn.innerHTML = SVG_ICONS.edit;
    editBtn.title = 'Edit prompt';
    editBtn.onclick = () => {
      const promptInput = document.getElementById('promptInput');
      promptInput.value = lastUserPrompt;
      promptInput.focus();
      promptInput.style.height = 'auto';
      promptInput.style.height = promptInput.scrollHeight + 'px';
    };
    messageActions.appendChild(editBtn);

    messageGroup.appendChild(messageActions);

    // Save assistant message
    await saveMessage('assistant', fullText);
    console.log('Regenerated text:', fullText);
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('⏹ Regeneration stopped by user');
      // Save the partial message that was streamed
      if (fullText && fullText.trim()) {
        await saveMessage('assistant', fullText);
        console.log('Saved partial regenerated text:', fullText);
      }
    } else {
      console.error('Error regenerating response:', error);
      addMessage('assistant', '❌ Error regenerating response. Please try again.');
    }
  } finally {
    isGenerating = false;
    sendButton.innerHTML = SVG_ICONS.send;
    sendButton.disabled = false;
    sendButton.onclick = sendMessage;
  }
}

// Auto-expand textarea
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize DB and load chats
  await initializeDB();
  await loadAllChats();
  updateStorageInfo();

  // Theme toggle is already initialized in index.html - no need to reinitialize
  // initThemeToggle();

  // Auto-initialize the model on page load
  console.log('🚀 Auto-initializing model...');

  // If we previously detected a crash, warn but still attempt initialization
  // (user may have restarted Chrome as instructed)
  try {
    if (localStorage.getItem('chrome-ai-restart-required') === '1') {
      console.warn('⚠️ Previous session had a crash. Attempting to initialize anyway (user may have restarted Chrome)...');
      // Don't block - let checkAvailability() try and handle the error if it fails again
    }
  } catch { }

  // Wire up download button
  const downloadBtn = document.getElementById('downloadModelBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      downloadGeminiNano().catch(console.error);
    });
  }

  checkAvailability();

  const promptInput = document.getElementById('promptInput');
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
  });

  // Handle Enter key to send message (Ctrl+Enter or Enter without Shift)
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Temperature slider
  document.getElementById('temperatureSlider').addEventListener('input', (e) => {
    document.getElementById('tempValue').textContent = parseFloat(e.target.value).toFixed(1);
  });

  // Top K slider
  document.getElementById('topKSlider').addEventListener('input', (e) => {
    document.getElementById('topKValue').textContent = e.target.value;
  });

  // Word limit checkbox and slider
  const wordLimitCheckbox = document.getElementById('wordLimitCheckbox');
  const wordLimitSlider = document.getElementById('wordLimitSlider');
  wordLimitCheckbox.addEventListener('change', (e) => {
    wordLimitEnabled = e.target.checked;
    wordLimitSlider.disabled = !e.target.checked;
  });
  wordLimitSlider.addEventListener('input', (e) => {
    maxResponseWords = parseInt(e.target.value);
    document.getElementById('wordLimitValue').textContent = e.target.value;
  });

  // Storage limit checkbox and slider
  const storageLimitCheckbox = document.getElementById('storageLimitCheckbox');
  const storageLimitSlider = document.getElementById('storageLimitSlider');
  storageLimitCheckbox.addEventListener('change', (e) => {
    storageLimitEnabled = e.target.checked;
    storageLimitSlider.disabled = !e.target.checked;
  });
  storageLimitSlider.addEventListener('input', (e) => {
    const limitMB = parseInt(e.target.value);
    MAX_STORAGE = limitMB * 1024 * 1024;
    document.getElementById('storageLimitValue').textContent = e.target.value;
  });

  // Settings button
  document.getElementById('settingsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSettings();
  });

  // Settings close button
  document.getElementById('settingsCloseBtn').addEventListener('click', closeSettings);

  // Close settings when clicking outside
  document.addEventListener('click', (e) => {
    const settingsPanel = document.getElementById('settingsPanel');
    const settingsBtn = document.getElementById('settingsBtn');
    
    if (settingsPanel.classList.contains('open')) {
      // Check if click is outside settings panel and not on settings button
      if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
        closeSettings();
      }
    }
  });

  // Storage folder picker button
  document.getElementById('selectStorageFolder').addEventListener('click', selectStorageFolder);

  // Clear browser storage button
  document.getElementById('clearBrowserStorage').addEventListener('click', clearBrowserStorage);

  // Check current storage path on load
  checkStoragePath();

  // Send button
  document.getElementById('sendButton').addEventListener('click', sendMessage);

  // New chat button
  document.querySelector('.new-chat-btn').addEventListener('click', async () => {
    // Create a fresh session to clear conversation context
    try {
      // Reset the aiSession (destroys old session and allows fresh one to be created)
      await aiSession.reset();
      console.log('🗑️ Destroyed old session');

      // Get the new session
      session = await aiSession.ensure();
      console.log('✅ Created fresh session for new chat (context cleared)');
    } catch (error) {
      console.error('Error creating new session:', error);
      // If creation fails, try to reinitialize
      await checkAvailability();
    }

    const chat = await saveChat('New Chat');
    document.getElementById('chatArea').innerHTML = `
      <div class="welcome-message">
        <h2>Optiease AI</h2>
        <p>New Chat</p>
        <p>Type your first message to get started</p>
      </div>
    `;
    promptInput.value = '';
    promptInput.focus();
    await loadAllChats();
  });

  // File upload button
  const uploadBtn = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('fileInput');

  uploadBtn.addEventListener('click', async () => {
    // Try to use File System Access API for full path access
    if ('showOpenFilePicker' in window) {
      try {
        const fileHandles = await window.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: 'Supported Files',
              accept: {
                'text/plain': ['.txt', '.md'],
                'application/pdf': ['.pdf'],
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
                'application/msword': ['.doc'],
                'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
                'audio/*': ['.mp3', '.wav', '.m4a']
              }
            }
          ]
        });

        // Get files from handles with full path
        const filesWithPath = await Promise.all(fileHandles.map(async handle => {
          const file = await handle.getFile();
          // Store the file handle for potential future access
          const fileWithPath = new File([file], file.name, { type: file.type });
          fileWithPath.fullPath = handle.name; // Store the file name (path not available due to security)
          fileWithPath.fileHandle = handle; // Store handle for future access
          return fileWithPath;
        }));

        await handleFileUpload(filesWithPath);
      } catch (err) {
        // User cancelled or API not supported, fall back to regular input
        if (err.name !== 'AbortError') {
          console.warn('File System Access API failed, using fallback:', err);
          fileInput.click();
        }
      }
    } else {
      // Fallback to traditional file input
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', (e) => {
    handleFileUpload(e.target.files);
    // Reset file input so same file can be uploaded again
    fileInput.value = '';
  });

  // File widget close button
  document.getElementById('fileWidgetClose').addEventListener('click', clearFileWidget);

  // YouTube URL button
  const youtubeBtn = document.getElementById('youtubeBtn');
  youtubeBtn.addEventListener('click', async () => {
    const url = prompt('Enter YouTube URL:');
    if (url && url.trim()) {
      const trimmedUrl = url.trim();

      // Validate YouTube URL
      const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/;
      if (!youtubeRegex.test(trimmedUrl)) {
        alert('Please enter a valid YouTube URL (e.g., https://www.youtube.com/watch?v=...)');
        return;
      }

      // Create a virtual "file" object for the YouTube URL
      const youtubeFile = {
        name: trimmedUrl,
        type: 'video/youtube',
        size: 0,
        youtubeUrl: trimmedUrl
      };

      await handleFileUpload([youtubeFile]);
    }
  });
});

// Toggle settings panel
function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  panel.classList.toggle('open');
}

// Close settings panel
function closeSettings() {
  const panel = document.getElementById('settingsPanel');
  panel.classList.remove('open');
}

// Theme toggle functionality
// Theme toggle functionality moved to index.html to avoid conflicts
// Removed duplicate initThemeToggle() function

// ==================== SERVER STORAGE FUNCTIONS ====================

const SERVER_URL = 'http://localhost:5000';
let useServerStorage = false;
let serverStoragePath = null;

// Check if server storage is configured
async function checkStoragePath() {
  try {
    const response = await fetch(`${SERVER_URL}/get_storage_path`);
    const data = await response.json();

    if (data.using_server_storage && data.path) {
      useServerStorage = true;
      serverStoragePath = data.path;
      updateStoragePathUI(data.path);
      console.log('📁 Using server storage:', data.path);
    } else {
      useServerStorage = false;
      updateStoragePathUI(null);
    }
  } catch (error) {
    console.error('Error checking storage path:', error);
    useServerStorage = false;
  }
}

// Update storage path UI
function updateStoragePathUI(path) {
  const pathEl = document.getElementById('storageFolderPath');
  if (path) {
    pathEl.textContent = `📁 ${path}`;
    pathEl.style.color = '#10a37f';
  } else {
    pathEl.textContent = 'Using browser storage (IndexedDB)';
    pathEl.style.color = '#666';
  }
}

// Select storage folder (native folder picker)
async function selectStorageFolder() {
  try {
    // Prompt user for folder path via simple input dialog
    const path = prompt('Enter the folder path where you want to store chat sessions:\n\nExample: C:\\Users\\YourName\\Documents\\OptieaseSessions',
      serverStoragePath || 'C:\\Users\\Downloads\\OptieaseSessions');

    if (!path) return; // User cancelled

    // Send to server
    const response = await fetch(`${SERVER_URL}/set_storage_path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path })
    });

    const data = await response.json();

    if (data.success) {
      useServerStorage = true;
      serverStoragePath = data.path;
      updateStoragePathUI(data.path);
      alert(`✅ Storage path set successfully!\n\nSessions will be saved to:\n${data.path}\n\nEach chat will have its own subfolder with:\n• session.json (chat history)\n• uploads/ (attached files)`);

      // Reload sessions from server if available
      await loadSessionsFromServer();
    } else {
      alert(`❌ Error setting storage path:\n${data.error}`);
    }
  } catch (error) {
    console.error('Error selecting storage folder:', error);
    alert(`❌ Error communicating with server:\n${error.message}\n\nMake sure server.py is running on http://localhost:5000`);
  }
}

// Save session to server
async function saveSessionToServer(chatData) {
  if (!useServerStorage || !serverStoragePath) {
    console.log('Server storage not configured, using IndexedDB');
    return false;
  }

  try {
    const response = await fetch(`${SERVER_URL}/save_session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chatData)
    });

    const data = await response.json();

    if (data.success) {
      console.log(`💾 Session saved to server: ${data.path}`);
      return true;
    } else {
      console.error('Error saving to server:', data.error);
      return false;
    }
  } catch (error) {
    console.error('Error saving session to server:', error);
    return false;
  }
}

// Load sessions from server
async function loadSessionsFromServer() {
  if (!useServerStorage || !serverStoragePath) {
    return null;
  }

  try {
    const response = await fetch(`${SERVER_URL}/load_sessions`);
    const data = await response.json();

    if (data.success) {
      console.log(`📂 Loaded ${data.count} sessions from server`);
      return data.sessions;
    } else {
      console.error('Error loading sessions:', data.error);
      return null;
    }
  } catch (error) {
    console.error('Error loading sessions from server:', error);
    return null;
  }
}

// Load specific session from server
async function loadSessionFromServer(chatId) {
  if (!useServerStorage || !serverStoragePath) {
    return null;
  }

  try {
    const response = await fetch(`${SERVER_URL}/load_session/${chatId}`);
    const data = await response.json();

    if (data.success) {
      console.log(`📖 Loaded session ${chatId} from server`);
      return data.session;
    } else {
      console.error('Error loading session:', data.error);
      return null;
    }
  } catch (error) {
    console.error('Error loading session from server:', error);
    return null;
  }
}

// Clear IndexedDB and migrate to server storage
async function clearBrowserStorage() {
  try {
    // Check if server storage is configured
    if (!useServerStorage || !serverStoragePath) {
      alert('⚠️ Please select a server storage folder first!');
      return;
    }

    // Confirm action
    const confirmMessage = 'This will:\n' +
      '1. Export all browser chats to server storage\n' +
      '2. Delete all browser storage (IndexedDB)\n' +
      '3. Use server storage only going forward\n\n' +
      'Continue?';

    if (!confirm(confirmMessage)) {
      return;
    }

    console.log('🗑️ Starting browser storage migration...');

    // Open IndexedDB
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ChromeAI', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // Get all chats
    const chats = await new Promise((resolve, reject) => {
      const transaction = db.transaction(['chats'], 'readonly');
      const store = transaction.objectStore('chats');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    console.log(`📦 Found ${chats.length} chats in browser storage`);

    if (chats.length === 0) {
      // No chats to migrate, just delete the database
      db.close();
      await new Promise((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase('ChromeAI');
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      });

      alert('✅ Browser storage cleared (no chats to migrate)');
      location.reload();
      return;
    }

    // Get all messages for each chat
    const messagesStore = db.transaction(['messages'], 'readonly').objectStore('messages');
    const chatData = [];

    for (const chat of chats) {
      const messages = await new Promise((resolve, reject) => {
        const index = messagesStore.index('chatId');
        const request = index.getAll(chat.id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      chatData.push({
        id: chat.id,
        title: chat.title,
        created_at: chat.created_at,
        updated_at: chat.updated_at,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          file: msg.file
        }))
      });
    }

    db.close();

    console.log(`📤 Exporting ${chatData.length} chats to server...`);

    // Export each chat to server
    let successCount = 0;
    let failCount = 0;

    for (const chat of chatData) {
      try {
        const response = await fetch(`${SERVER_URL}/save_session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: chat.id,
            title: chat.title,
            created_at: chat.created_at,
            updated_at: chat.updated_at,
            messages: chat.messages
          })
        });

        const result = await response.json();
        if (result.success) {
          successCount++;
          console.log(`✅ Exported chat: ${chat.title}`);
        } else {
          failCount++;
          console.error(`❌ Failed to export chat: ${chat.title}`, result.error);
        }
      } catch (error) {
        failCount++;
        console.error(`❌ Error exporting chat: ${chat.title}`, error);
      }
    }

    console.log(`📊 Export complete: ${successCount} success, ${failCount} failed`);

    if (failCount > 0) {
      alert(`⚠️ Migration partially failed:\n${successCount} chats exported\n${failCount} chats failed\n\nBrowser storage NOT cleared to prevent data loss.`);
      return;
    }

    // All chats exported successfully, delete IndexedDB
    console.log('🗑️ Deleting browser storage...');
    await new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase('ChromeAI');
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => reject(deleteRequest.error);
    });

    alert(`✅ Migration complete!\n\n${successCount} chats exported to:\n${serverStoragePath}\n\nBrowser storage cleared. Reloading...`);
    location.reload();

  } catch (error) {
    console.error('❌ Error during migration:', error);
    alert(`❌ Migration failed: ${error.message}\n\nBrowser storage NOT cleared to prevent data loss.`);
  }
}

// Clean up session when user leaves
window.addEventListener('beforeunload', () => {
  if (session) {
    session.destroy?.();
  }
});
