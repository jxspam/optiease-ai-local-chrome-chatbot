#!/usr/bin/env python3
"""
MarkItDown Flask Server for Optiease AI
Supports all MarkItDown file formats and YouTube transcript extraction
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import logging
import sys
import os
import traceback
from urllib.parse import urlparse, parse_qs
import json
from datetime import datetime
from pathlib import Path

# Configure logging first
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import YouTube transcript API directly for better reliability
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound, VideoUnavailable
    YOUTUBE_API_AVAILABLE = True
    logger.info("✅ youtube-transcript-api loaded successfully")
except ImportError:
    YOUTUBE_API_AVAILABLE = False
    logger.warning("⚠️ youtube-transcript-api not available. Install with: pip install youtube-transcript-api")

# Import yt-dlp as fallback for YouTube transcripts
try:
    import yt_dlp
    YTDLP_AVAILABLE = True
    logger.info("✅ yt-dlp loaded successfully")
except ImportError:
    YTDLP_AVAILABLE = False
    logger.warning("⚠️ yt-dlp not available. Install with: pip install yt-dlp")

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Session storage configuration
STORAGE_PATH = None  # Will be set by user via /set_storage_path endpoint
STORAGE_CONFIG_FILE = Path(__file__).parent / 'storage_config.json'

def sanitize_filename(filename):
    """
    Sanitize a filename to be safe for Windows/Unix file systems.
    Removes or replaces invalid characters and handles URLs.
    """
    import re
    
    # If it's a URL, extract a meaningful name
    if filename.startswith(('http://', 'https://', 'ftp://')):
        try:
            parsed = urlparse(filename)
            # For YouTube URLs, use 'youtube_video' as base name
            if 'youtube.com' in parsed.netloc or 'youtu.be' in parsed.netloc:
                video_id = None
                if 'youtu.be' in parsed.netloc:
                    video_id = parsed.path.strip('/')
                elif 'v=' in parsed.query:
                    video_id = parse_qs(parsed.query).get('v', [None])[0]
                
                if video_id:
                    filename = f'youtube_{video_id}.txt'
                else:
                    filename = 'youtube_video.txt'
            else:
                # For other URLs, use the last path segment or domain
                path_parts = [p for p in parsed.path.split('/') if p]
                if path_parts:
                    filename = path_parts[-1]
                else:
                    filename = parsed.netloc.replace('.', '_') + '.txt'
        except:
            filename = 'url_content.txt'
    
    # Replace invalid Windows characters: < > : " / \ | ? *
    # Also replace control characters (0-31)
    filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', filename)
    
    # Remove leading/trailing spaces and dots
    filename = filename.strip('. ')
    
    # Ensure the filename is not empty
    if not filename:
        filename = 'unnamed_file'
    
    # Limit length to 255 characters (common filesystem limit)
    if len(filename) > 255:
        name, ext = os.path.splitext(filename)
        if ext:
            filename = name[:255-len(ext)] + ext
        else:
            filename = filename[:255]
    
    return filename

def load_storage_config():
    """Load storage path from config file"""
    global STORAGE_PATH
    try:
        if STORAGE_CONFIG_FILE.exists():
            with open(STORAGE_CONFIG_FILE, 'r') as f:
                config = json.load(f)
                STORAGE_PATH = config.get('storage_path')
                if STORAGE_PATH:
                    logger.info(f"📁 Loaded storage path: {STORAGE_PATH}")
    except Exception as e:
        logger.error(f"Error loading storage config: {e}")

def save_storage_config(path):
    """Save storage path to config file"""
    try:
        with open(STORAGE_CONFIG_FILE, 'w') as f:
            json.dump({'storage_path': path}, f, indent=2)
        logger.info(f"💾 Saved storage path: {path}")
    except Exception as e:
        logger.error(f"Error saving storage config: {e}")

# Load storage config on startup
load_storage_config()

# Check if MarkItDown is installed
try:
    from markitdown import MarkItDown
    MARKITDOWN_AVAILABLE = True
    logger.info("✓ MarkItDown library loaded successfully")
except ImportError:
    MARKITDOWN_AVAILABLE = False
    logger.warning("⚠️ MarkItDown not installed. Install with: pip install 'markitdown[all]'")

# Supported file formats by MarkItDown
SUPPORTED_FORMATS = {
    # Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'rtf': 'text/rtf',
    
    # Presentations
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    
    # Spreadsheets
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'csv': 'text/csv',
    
    # Data formats
    'json': 'application/json',
    'xml': 'application/xml',
    
    # Web formats
    'html': 'text/html',
    'htm': 'text/html',
    
    # Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    
    # Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'm4a': 'audio/mp4',
    'ogg': 'audio/ogg',
    'aac': 'audio/aac',
    
    # Archives
    'zip': 'application/zip',
    'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    
    # Text
    'txt': 'text/plain',
    'md': 'text/markdown',
    
    # Email
    'msg': 'application/vnd.ms-outlook',
    'eml': 'message/rfc822'
}


def clean_youtube_url(url):
    """
    Clean YouTube URL by removing tracking parameters
    Extracts video ID and returns clean URL
    """
    import re
    from urllib.parse import urlparse, parse_qs
    
    # Extract video ID
    video_id = None
    
    # Handle youtu.be format
    if 'youtu.be' in url:
        match = re.search(r'youtu\.be/([a-zA-Z0-9_-]+)', url)
        if match:
            video_id = match.group(1)
    
    # Handle youtube.com format
    elif 'youtube.com' in url:
        parsed = urlparse(url)
        query_params = parse_qs(parsed.query)
        video_id = query_params.get('v', [None])[0]
    
    if video_id:
        # Return clean URL
        clean_url = f"https://www.youtube.com/watch?v={video_id}"
        logger.info(f"Cleaned URL: {url} -> {clean_url}")
        return clean_url
    
    return url


def extract_youtube_video_id(url):
    """
    Extract video ID from YouTube URL
    """
    import re
    
    # Handle youtu.be format
    if 'youtu.be' in url:
        match = re.search(r'youtu\.be/([a-zA-Z0-9_-]+)', url)
        if match:
            return match.group(1)
    
    # Handle youtube.com format
    if 'youtube.com' in url:
        parsed = urlparse(url)
        query_params = parse_qs(parsed.query)
        return query_params.get('v', [None])[0]
    
    return None


def get_youtube_transcript(url):
    """
    Extract YouTube transcript using direct API (more reliable than MarkItDown)
    Falls back to yt-dlp if youtube-transcript-api fails
    Returns: dict with 'text', 'title', 'success' keys
    """
    video_id = extract_youtube_video_id(url)
    if not video_id:
        raise ValueError(f"Could not extract video ID from URL: {url}")
    
    logger.info(f"📺 Extracting transcript for video ID: {video_id} from URL: {url}")
    
    # Try yt-dlp first (more reliable for problematic videos)
    if YTDLP_AVAILABLE:
        try:
            logger.info("🔄 Trying yt-dlp method...")
            
            ydl_opts = {
                'skip_download': True,
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': ['en'],
                'quiet': True,
                'no_warnings': True,
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
                
                # Get subtitles
                subtitles = info.get('subtitles', {}).get('en') or info.get('automatic_captions', {}).get('en')
                
                if subtitles:
                    # Find the best subtitle format (prefer json3, srv3, or vtt - avoid m3u8 playlists)
                    subtitle_url = None
                    selected_ext = None
                    
                    # Priority: json3 > srv3 > vtt > srv2 > srv1 (avoid m3u8)
                    priority_formats = ['json3', 'srv3', 'vtt', 'srv2', 'srv1']
                    
                    for fmt in priority_formats:
                        for sub in subtitles:
                            if sub.get('ext') == fmt:
                                subtitle_url = sub['url']
                                selected_ext = fmt
                                break
                        if subtitle_url:
                            break
                    
                    # If no priority format found, use any non-m3u8 format
                    if not subtitle_url:
                        for sub in subtitles:
                            if sub.get('ext') != 'm3u8':
                                subtitle_url = sub['url']
                                selected_ext = sub.get('ext')
                                break
                    
                    if subtitle_url:
                        logger.info(f"📥 Downloading subtitle format: {selected_ext} from URL")
                        import requests
                        response = requests.get(subtitle_url, timeout=30)
                        
                        if response.status_code == 200:
                            content = response.text
                            
                            # Check if we accidentally got an M3U8 playlist
                            if content.startswith('#EXTM3U') or '#EXT-X-' in content:
                                logger.warning("⚠️ Got M3U8 playlist instead of subtitles, skipping yt-dlp method")
                                raise Exception("M3U8 playlist received instead of subtitles")
                            
                            # Parse different subtitle formats
                            import re
                            
                            if selected_ext == 'json3':
                                # YouTube JSON3 format
                                try:
                                    import json
                                    data = json.loads(content)
                                    events = data.get('events', [])
                                    text_lines = []
                                    for event in events:
                                        if 'segs' in event:
                                            for seg in event['segs']:
                                                if 'utf8' in seg:
                                                    text_lines.append(seg['utf8'].strip())
                                    full_text = ' '.join(text_lines)
                                    # Clean up extra spaces
                                    full_text = re.sub(r'\s+', ' ', full_text).strip()
                                except Exception as json_err:
                                    logger.error(f"JSON3 parsing failed: {json_err}")
                                    raise
                            
                            elif selected_ext in ['srv1', 'srv2', 'srv3']:
                                # YouTube SRV (XML) format
                                try:
                                    # Simple XML parsing - extract text between <text> tags
                                    text_matches = re.findall(r'<text[^>]*>(.*?)</text>', content, re.DOTALL)
                                    text_lines = []
                                    for text in text_matches:
                                        # Remove HTML entities and tags
                                        text = re.sub(r'&amp;', '&', text)
                                        text = re.sub(r'&lt;', '<', text)
                                        text = re.sub(r'&gt;', '>', text)
                                        text = re.sub(r'&quot;', '"', text)
                                        text = re.sub(r'&#39;', "'", text)
                                        text = re.sub(r'<[^>]+>', '', text)
                                        text = text.strip()
                                        if text:
                                            text_lines.append(text)
                                    full_text = ' '.join(text_lines)
                                except Exception as srv_err:
                                    logger.error(f"SRV parsing failed: {srv_err}")
                                    raise
                            
                            elif 'WEBVTT' in content or selected_ext == 'vtt':
                                # VTT format
                                lines = content.split('\n')
                                text_lines = []
                                for line in lines:
                                    line = line.strip()
                                    # Skip empty lines, timestamps, WEBVTT headers, and cue identifiers
                                    if line and not line.startswith('WEBVTT') and '-->' not in line and not re.match(r'^\d+$', line) and not line.startswith('NOTE'):
                                        # Remove HTML tags
                                        line = re.sub(r'<[^>]+>', '', line)
                                        if line:
                                            text_lines.append(line)
                                full_text = ' '.join(text_lines)
                            
                            else:
                                # Unknown format, try basic text extraction
                                full_text = content
                            
                            # Clean up the text
                            full_text = re.sub(r'\s+', ' ', full_text).strip()
                            
                            if full_text and len(full_text) > 50:  # Ensure we got meaningful content
                                logger.info(f"✅ yt-dlp extracted {len(full_text)} characters using {selected_ext} format")
                                logger.info(f"📄 Text preview: {full_text[:200]}...")
                                
                                return {
                                    'success': True,
                                    'text': full_text,
                                    'video_id': video_id,
                                    'language': 'en',
                                    'is_generated': True
                                }
                            else:
                                logger.warning(f"⚠️ Extracted text too short ({len(full_text)} chars), trying next method")
                                raise Exception("Insufficient content extracted")
        except Exception as ytdlp_error:
            logger.warning(f"⚠️ yt-dlp method failed: {str(ytdlp_error)}")
    
    # Fallback to youtube-transcript-api
    if not YOUTUBE_API_AVAILABLE:
        raise Exception("No YouTube transcript extraction method available. Install youtube-transcript-api or yt-dlp")
    
    try:
        # Try the simpler get_transcript method first (more reliable)
        try:
            logger.info(f"🔄 Trying simple transcript fetch...")
            transcript_data = YouTubeTranscriptApi.get_transcript(video_id, languages=['en', 'en-US', 'en-GB'])
            
            # Convert to readable text
            full_text = "\n".join([entry['text'] for entry in transcript_data])
            
            logger.info(f"✅ Successfully extracted {len(full_text)} characters using simple method")
            logger.info(f"📄 Text preview: {full_text[:200]}...")
            
            return {
                'success': True,
                'text': full_text,
                'video_id': video_id,
                'language': 'en',
                'is_generated': True
            }
        except:
            logger.info(f"⚠️ Simple method failed, trying advanced method...")
        
        # Get available transcripts
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        
        # Log all available transcripts for debugging
        available_langs = []
        for t in transcript_list:
            available_langs.append(f"{t.language}({'auto' if t.is_generated else 'manual'})")
        logger.info(f"📋 Available transcripts: {', '.join(available_langs)}")
        
        # Try to get English transcript first, or any available
        transcript = None
        try:
            transcript = transcript_list.find_transcript(['en', 'en-US', 'en-GB'])
            logger.info(f"✅ Found English transcript (is_generated: {transcript.is_generated})")
        except NoTranscriptFound:
            # Get the first available transcript
            available = list(transcript_list)
            if available:
                transcript = available[0]
                logger.info(f"ℹ️ Using {transcript.language} transcript (English not available, is_generated: {transcript.is_generated})")
            else:
                raise NoTranscriptFound(video_id, [], None)
        
        # Fetch the transcript with error handling
        try:
            transcript_data = transcript.fetch()
        except Exception as fetch_error:
            logger.error(f"❌ Transcript fetch failed: {str(fetch_error)}")
            # Try alternative: get all available transcripts and try each one
            try:
                logger.info("🔄 Trying alternative method - getting all transcripts...")
                all_transcripts = list(transcript_list)
                for alt_transcript in all_transcripts:
                    try:
                        logger.info(f"   Trying {alt_transcript.language}...")
                        transcript_data = alt_transcript.fetch()
                        transcript = alt_transcript  # Update to the working one
                        logger.info(f"   ✅ Success with {alt_transcript.language}")
                        break
                    except:
                        continue
                else:
                    raise Exception(f"All transcript fetches failed. Original error: {str(fetch_error)}")
            except Exception as alt_error:
                raise Exception(f"Could not fetch transcript. Try: {str(alt_error)}")
        
        # Log first few entries for debugging
        logger.info(f"📝 First 3 transcript entries: {transcript_data[:3] if len(transcript_data) >= 3 else transcript_data}")
        
        # Convert to readable text
        full_text = "\n".join([entry['text'] for entry in transcript_data])
        
        # Log preview of extracted text
        preview = full_text[:200] + "..." if len(full_text) > 200 else full_text
        logger.info(f"✅ Successfully extracted {len(full_text)} characters from YouTube")
        logger.info(f"📄 Text preview: {preview}")
        
        return {
            'success': True,
            'text': full_text,
            'video_id': video_id,
            'language': transcript.language,
            'is_generated': transcript.is_generated
        }
        
    except TranscriptsDisabled:
        raise Exception("Transcripts are disabled for this video")
    except NoTranscriptFound:
        raise Exception("No transcripts found for this video. The video may not have captions/subtitles available.")
    except VideoUnavailable:
        raise Exception("Video is unavailable or private")
    except Exception as e:
        logger.error(f"❌ YouTube transcript extraction failed: {str(e)}")
        raise


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'markitdown_available': MARKITDOWN_AVAILABLE,
        'supported_formats': list(SUPPORTED_FORMATS.keys())
    })


@app.route('/convert', methods=['POST'])
def convert_file():
    """
    Convert various file formats to Markdown
    
    Accepts:
    - multipart/form-data with 'file' field
    - JSON with 'url' field (for remote files or YouTube)
    
    Returns:
    - JSON with 'text' field containing converted content (for compatibility)
    - Also includes 'markdown' and optional 'title' fields
    """
    if not MARKITDOWN_AVAILABLE:
        return jsonify({
            'error': 'MarkItDown not installed',
            'message': 'Install with: pip install "markitdown[all]"'
        }), 500
    
    try:
        md = MarkItDown()
        
        # Handle file upload
        if 'file' in request.files:
            file = request.files['file']
            if file.filename == '':
                return jsonify({'error': 'No file selected'}), 400
            
            logger.info(f"Converting uploaded file: {file.filename}")
            
            # Save temporarily and convert
            temp_path = f"temp_{file.filename}"
            file.save(temp_path)
            
            try:
                result = md.convert(temp_path)
                os.remove(temp_path)  # Clean up
                
                return jsonify({
                    'success': True,
                    'text': result.text_content,  # For compatibility with old code
                    'markdown': result.markdown,
                    'title': result.title,
                    'filename': file.filename
                })
            except Exception as e:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                logger.error(f"Conversion error: {str(e)}")
                traceback.print_exc()
                return jsonify({
                    'error': f'Conversion failed: {str(e)}'
                }), 500
        
        # Handle URL conversion (including YouTube)
        elif request.is_json:
            data = request.get_json()
            
            if 'url' in data:
                url = data['url']
                logger.info(f"Converting from URL: {url}")
                
                # Check if it's a YouTube URL
                is_youtube = 'youtube.com' in url or 'youtu.be' in url
                logger.info(f"🔍 YouTube URL check: is_youtube={is_youtube}, url contains 'youtu'={('youtu' in url)}")
                
                if is_youtube:
                    logger.info("🎬 Detected YouTube URL - using direct transcript API")
                    # Clean YouTube URL (remove tracking parameters)
                    url = clean_youtube_url(url)
                    
                    try:
                        # Use direct YouTube API for better reliability
                        result = get_youtube_transcript(url)
                        
                        logger.info(f"✅ YouTube transcript: {len(result['text'])} chars, language: {result.get('language', 'unknown')}")
                        
                        return jsonify({
                            'success': True,
                            'text': result['text'],
                            'markdown': result['text'],  # Transcript is plain text
                            'title': f"YouTube Transcript ({result['video_id']})",
                            'source_url': url,
                            'type': 'youtube',
                            'language': result.get('language'),
                            'is_generated': result.get('is_generated', False)
                        })
                        
                    except Exception as e:
                        logger.error(f"❌ YouTube transcript extraction failed: {str(e)}")
                        return jsonify({
                            'error': 'YouTube transcript extraction failed',
                            'message': str(e),
                            'url': url
                        }), 500
                
                # Non-YouTube URL - use MarkItDown
                try:
                    result = md.convert(url)
                    
                    # Validate that we got meaningful content (not just empty/error)
                    if not result.text_content or len(result.text_content.strip()) < 10:
                        logger.error("No content extracted from URL")
                        return jsonify({
                            'error': 'No content extracted from URL',
                            'url': url
                        }), 500
                    
                    # Check if the result looks like an error message
                    text_lower = result.text_content.lower()
                    if 'no element found' in text_lower or 'attempt' in text_lower and 'failed' in text_lower:
                        logger.error("Conversion produced error-like content")
                        return jsonify({
                            'error': 'URL conversion failed - unable to extract content',
                            'message': 'The content could not be properly extracted. For YouTube videos, ensure captions/subtitles are available.',
                            'url': url
                        }), 500
                    
                    logger.info(f"Successfully converted URL. Content length: {len(result.text_content)} chars")
                    
                    return jsonify({
                        'success': True,
                        'text': result.text_content,  # For compatibility
                        'markdown': result.markdown,
                        'title': result.title,
                        'source_url': url,
                        'type': 'url'
                    })
                except Exception as e:
                    logger.error(f"Error converting URL: {str(e)}")
                    traceback.print_exc()
                    
                    return jsonify({
                        'error': 'Conversion failed',
                        'message': str(e),
                        'url': url
                    }), 500
            
            else:
                return jsonify({'error': 'Missing required field: url or file'}), 400
        
        else:
            return jsonify({'error': 'Invalid request format. Send file or JSON with url'}), 400
    
    except Exception as e:
        logger.error(f"Conversion error: {str(e)}", exc_info=True)
        return jsonify({
            'error': 'Conversion failed',
            'message': str(e)
        }), 500


@app.route('/youtube', methods=['POST'])
def convert_youtube():
    """
    Convert YouTube video to Markdown (extract transcript)
    
    Expects JSON with 'url' field containing YouTube URL
    
    Returns:
    - JSON with 'text'/'markdown' (video title + transcript) and 'title' fields
    """
    if not YOUTUBE_API_AVAILABLE:
        return jsonify({
            'error': 'YouTube transcript API not installed',
            'message': 'Install with: pip install youtube-transcript-api'
        }), 500
    
    try:
        data = request.get_json()
        url = data.get('url')
        
        if not url:
            return jsonify({'error': 'Missing YouTube URL'}), 400
        
        # Validate YouTube URL
        if 'youtube.com' not in url and 'youtu.be' not in url:
            return jsonify({'error': 'Invalid YouTube URL'}), 400
        
        logger.info(f"🎬 Extracting YouTube transcript: {url}")
        
        # Clean YouTube URL (remove tracking parameters)
        url = clean_youtube_url(url)
        
        # Use direct YouTube API
        result = get_youtube_transcript(url)
        
        logger.info(f"✅ YouTube transcript: {len(result['text'])} chars, language: {result.get('language', 'unknown')}")
        
        return jsonify({
            'success': True,
            'text': result['text'],
            'markdown': result['text'],  # Transcript is plain text
            'title': f"YouTube Transcript ({result['video_id']})",
            'url': url,
            'type': 'youtube',
            'language': result.get('language'),
            'is_generated': result.get('is_generated', False)
        })
    
    except Exception as e:
        logger.error(f"❌ YouTube conversion error: {str(e)}", exc_info=True)
        traceback.print_exc()
        
        return jsonify({
            'error': 'YouTube conversion failed',
            'message': str(e),
            'url': url
        }), 500


@app.route('/convert-multiple', methods=['POST'])
def convert_multiple():
    """
    Convert multiple uploaded files to markdown/text
    
    Returns: JSON with array of converted files
    """
    if not MARKITDOWN_AVAILABLE:
        return jsonify({
            'error': 'MarkItDown not installed',
            'message': 'Install with: pip install "markitdown[all]"'
        }), 500
    
    try:
        if 'files' not in request.files:
            return jsonify({"error": "No files provided"}), 400
        
        files = request.files.getlist('files')
        if not files:
            return jsonify({"error": "No files selected"}), 400
        
        md = MarkItDown()
        results = []
        
        for file in files:
            if file.filename == '':
                continue
            
            temp_path = f"temp_{file.filename}"
            file.save(temp_path)
            
            try:
                result = md.convert(temp_path)
                results.append({
                    "filename": file.filename,
                    "text": result.text_content,
                    "markdown": result.markdown,
                    "title": result.title,
                    "success": True
                })
            except Exception as e:
                logger.error(f"Error converting {file.filename}: {str(e)}")
                results.append({
                    "filename": file.filename,
                    "error": str(e),
                    "success": False
                })
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except:
                        pass
        
        return jsonify({
            "success": True,
            "files": results
        })
        
    except Exception as e:
        logger.error(f"Batch conversion failed: {str(e)}")
        traceback.print_exc()
        return jsonify({
            "error": f"Batch conversion failed: {str(e)}"
        }), 500


@app.route('/formats', methods=['GET'])
def get_supported_formats():
    """Get list of supported file formats"""
    return jsonify({
        'formats': SUPPORTED_FORMATS,
        'categories': {
            'documents': ['pdf', 'doc', 'docx', 'rtf', 'txt', 'md'],
            'presentations': ['ppt', 'pptx'],
            'spreadsheets': ['xls', 'xlsx', 'csv'],
            'data': ['json', 'xml'],
            'web': ['html', 'htm'],
            'images': ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'],
            'audio': ['mp3', 'wav', 'm4a', 'ogg', 'aac'],
            'archives': ['zip', 'rar', '7z', 'tar', 'gz'],
            'email': ['msg', 'eml'],
            'youtube': ['YouTube URLs (transcript extraction)']
        }
    })


# ==================== SESSION STORAGE ENDPOINTS ====================

@app.route('/set_storage_path', methods=['POST'])
def set_storage_path():
    """Set the folder path where sessions will be stored"""
    global STORAGE_PATH
    
    try:
        data = request.get_json()
        path = data.get('path')
        
        if not path:
            return jsonify({'success': False, 'error': 'No path provided'}), 400
        
        # Validate path exists and is writable
        path_obj = Path(path)
        if not path_obj.exists():
            try:
                path_obj.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                return jsonify({'success': False, 'error': f'Cannot create directory: {str(e)}'}), 400
        
        if not path_obj.is_dir():
            return jsonify({'success': False, 'error': 'Path is not a directory'}), 400
        
        # Test write permissions
        test_file = path_obj / '.write_test'
        try:
            test_file.write_text('test')
            test_file.unlink()
        except Exception as e:
            return jsonify({'success': False, 'error': f'Directory is not writable: {str(e)}'}), 400
        
        STORAGE_PATH = str(path_obj.absolute())
        save_storage_config(STORAGE_PATH)
        
        logger.info(f"✅ Storage path set to: {STORAGE_PATH}")
        return jsonify({
            'success': True,
            'path': STORAGE_PATH,
            'message': 'Storage path configured successfully'
        })
        
    except Exception as e:
        logger.error(f"Error setting storage path: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/get_storage_path', methods=['GET'])
def get_storage_path():
    """Get the current storage path"""
    return jsonify({
        'path': STORAGE_PATH,
        'using_server_storage': STORAGE_PATH is not None
    })


@app.route('/save_session', methods=['POST'])
def save_session():
    """Save a chat session to disk"""
    if not STORAGE_PATH:
        return jsonify({'success': False, 'error': 'Storage path not configured'}), 400
    
    try:
        data = request.get_json()
        chat_id = data.get('chat_id')
        chat_title = data.get('chat_title', 'Untitled Chat')
        messages = data.get('messages', [])
        
        if not chat_id:
            return jsonify({'success': False, 'error': 'No chat_id provided'}), 400
        
        # Create chat-specific folder
        chat_folder = Path(STORAGE_PATH) / f"chat_{chat_id}"
        chat_folder.mkdir(parents=True, exist_ok=True)
        
        # Save session metadata and messages
        session_file = chat_folder / 'session.json'
        session_data = {
            'chat_id': chat_id,
            'title': chat_title,
            'created_at': data.get('created_at', datetime.now().isoformat()),
            'updated_at': datetime.now().isoformat(),
            'messages': messages
        }
        
        with open(session_file, 'w', encoding='utf-8') as f:
            json.dump(session_data, f, indent=2, ensure_ascii=False)
        
        # Save uploaded files if any
        for msg in messages:
            if msg.get('files'):
                for file_data in msg['files']:
                    if file_data.get('content') or file_data.get('fileData'):
                        original_name = file_data.get('name', 'unnamed_file')
                        file_name = sanitize_filename(original_name)
                        file_path = chat_folder / 'uploads' / file_name
                        file_path.parent.mkdir(exist_ok=True)
                        
                        # Save file content
                        content = file_data.get('content') or file_data.get('fileData', '')
                        if isinstance(content, str):
                            file_path.write_text(content, encoding='utf-8')
                        else:
                            file_path.write_bytes(content)
        
        logger.info(f"💾 Saved session {chat_id}: {chat_title}")
        return jsonify({
            'success': True,
            'chat_id': chat_id,
            'path': str(chat_folder),
            'message': f'Session saved to {chat_folder}'
        })
        
    except Exception as e:
        logger.error(f"Error saving session: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/load_sessions', methods=['GET'])
def load_sessions():
    """Load all chat sessions from disk"""
    if not STORAGE_PATH:
        return jsonify({'success': False, 'error': 'Storage path not configured'}), 400
    
    try:
        storage_dir = Path(STORAGE_PATH)
        sessions = []
        
        # Find all chat folders
        for chat_folder in storage_dir.glob('chat_*'):
            if chat_folder.is_dir():
                session_file = chat_folder / 'session.json'
                if session_file.exists():
                    with open(session_file, 'r', encoding='utf-8') as f:
                        session_data = json.load(f)
                        sessions.append({
                            'chat_id': session_data.get('chat_id'),
                            'title': session_data.get('title'),
                            'created_at': session_data.get('created_at'),
                            'updated_at': session_data.get('updated_at'),
                            'message_count': len(session_data.get('messages', []))
                        })
        
        # Sort by updated_at descending
        sessions.sort(key=lambda x: x.get('updated_at', ''), reverse=True)
        
        logger.info(f"📂 Loaded {len(sessions)} sessions from disk")
        return jsonify({
            'success': True,
            'sessions': sessions,
            'count': len(sessions)
        })
        
    except Exception as e:
        logger.error(f"Error loading sessions: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/load_session/<chat_id>', methods=['GET'])
def load_session(chat_id):
    """Load a specific chat session from disk"""
    if not STORAGE_PATH:
        return jsonify({'success': False, 'error': 'Storage path not configured'}), 400
    
    try:
        chat_folder = Path(STORAGE_PATH) / f"chat_{chat_id}"
        session_file = chat_folder / 'session.json'
        
        if not session_file.exists():
            return jsonify({'success': False, 'error': 'Session not found'}), 404
        
        with open(session_file, 'r', encoding='utf-8') as f:
            session_data = json.load(f)
        
        logger.info(f"📖 Loaded session {chat_id}")
        return jsonify({
            'success': True,
            'session': session_data
        })
        
    except Exception as e:
        logger.error(f"Error loading session {chat_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404


@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    
    logger.info("=" * 60)
    logger.info("🚀 Optiease AI MarkItDown MCP Server")
    logger.info("=" * 60)
    logger.info(f"MarkItDown Available: {MARKITDOWN_AVAILABLE}")
    logger.info(f"Supported Formats: {len(SUPPORTED_FORMATS)}")
    logger.info(f"Server Port: {port}")
    logger.info(f"Health check: http://localhost:{port}/health")
    logger.info(f"Convert file: POST http://localhost:{port}/convert")
    logger.info(f"Convert YouTube: POST http://localhost:{port}/youtube")
    logger.info(f"Formats list: GET http://localhost:{port}/formats")
    logger.info("=" * 60)
    
    if not MARKITDOWN_AVAILABLE:
        logger.warning("")
        logger.warning("⚠️  WARNING: MarkItDown not installed!")
        logger.warning("Install with one of these commands:")
        logger.warning("  pip install 'markitdown[all]'  # All features")
        logger.warning("  pip install 'markitdown[pdf,docx,pptx,xlsx,youtube-transcription]'  # Common formats")
        logger.warning("")
    
    # Run the server
    app.run(
        host='localhost',
        port=port,
        debug=False
    )
