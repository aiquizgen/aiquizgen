from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
import json
import traceback
import re
from openai import OpenAI
import PyPDF2
from io import BytesIO

# --- Library Check and Imports ---
try:
    # Ensure PyPDF2 is available
    import PyPDF2
    PDF_SUPPORT = True
except ImportError:
    # In a production environment, this should be logged, not just printed
    print("PyPDF2 not installed. PDF extraction will be disabled. Install with: pip install pypdf2")
    PDF_SUPPORT = False
# --- End Library Check ---

# Load environment variables
load_dotenv()

# --- API Key Setup ---
# Use os.environ.get() for safer environment variable access on platforms like Render
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    # This will fail the deployment if the variable is missing, which is correct for production
    raise ValueError("GEMINI_API_KEY environment variable not set.")

# --- Client Initialization (Using OpenAI client for Gemini) ---
try:
    client = OpenAI(
        api_key=GEMINI_API_KEY, 
        # Base URL to target the Gemini API endpoint
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/" 
    )
except Exception as e:
    print(f"Error initializing OpenAI client for Gemini: {e}")
    # Set client to None if initialization fails
    client = None

# Flask setup
# Static folder is 'public' as in your original code
app = Flask(__name__, static_folder="public")
CORS(app)
# Max content length is 50MB
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024 

# File upload configuration
ALLOWED_EXTENSIONS = {"pdf", "txt"}

# --- Constants for size limits ---
MAX_TEXT_SIZE_BYTES = 5 * 1024 * 1024 
MAX_API_CONTEXT_SIZE = 8000
MAX_PDF_PAGES = 1000

# Function Definitions (no change needed for business logic)
def allowed_file(filename):
    """Checks if the file extension is one of the allowed types (pdf, txt)."""
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_file(file):
    """Extract text from uploaded TXT or PDF file."""
    filename = file.filename
    extension = filename.rsplit(".", 1)[1].lower()
    
    file.seek(0)
    file_bytes = file.read()
    
    if extension == "txt":
        try:
            if len(file_bytes) > MAX_TEXT_SIZE_BYTES:
                file_bytes = file_bytes[:MAX_TEXT_SIZE_BYTES]
                
            return file_bytes.decode("utf-8", errors="ignore")
        except Exception as e:
            return f"[TXT parsing failed for {filename}. Error: {e}]"
    
    elif extension == "pdf" and PDF_SUPPORT:
        try:
            pdf_file = BytesIO(file_bytes)
            pdf_reader = PyPDF2.PdfReader(pdf_file)
            text = ""
            total_pages = len(pdf_reader.pages)
            pages_to_process = min(total_pages, MAX_PDF_PAGES)
            
            for i in range(pages_to_process):
                try:
                    page = pdf_reader.pages[i]
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
                        
                    if len(text) > MAX_API_CONTEXT_SIZE * 2: 
                        text = text[:MAX_API_CONTEXT_SIZE * 2] + "\n[Content truncated due to size limit during extraction]"
                        break
                except Exception as page_e:
                    print(f"Warning: Failed to extract text from page {i+1} of {filename}. Error: {page_e}")
                    continue
            
            if pages_to_process < total_pages:
                text += f"\n[Note: PDF has {total_pages} pages, processed first {pages_to_process} pages]"
            
            if text.strip():
                return text
            else:
                return f"[Text extraction from {filename} failed. File may be a scanned image without a text layer.]"
        
        except Exception as e:
            return f"[PDF parsing failed for {filename}. The file may be corrupt or non-standard. Error: {e}]"
    
    elif extension == "pdf" and not PDF_SUPPORT:
          return "[PDF file uploaded but PyPDF2 library not installed for text extraction.]"
    
    else:
        return f"[File type .{extension} is not supported.]"

# UTILITY FUNCTION for robust JSON parsing
def clean_and_parse_json(text, is_list=False):
    """
    Strips markdown blocks and aggressively isolates and cleans the JSON structure
    before attempting to parse it to handle common LLM output errors.
    """
    if not text:
        return None
    
    text = text.strip()

    # 1. Strip markdown code blocks 
    if text.startswith('```'):
        tag_end_match = re.match(r'```[a-zA-Z]*\s*', text)
        if tag_end_match:
            text = text[tag_end_match.end():]
    if text.endswith('```'):
        text = text[:-3]
    text = text.strip()

    # 2. Find the true start and end of the JSON object/array
    start_char = '[' if is_list else '{'
    end_char = ']' if is_list else '}'

    start_index = text.find(start_char)
    end_index = text.rfind(end_char)

    if start_index == -1 or end_index == -1 or end_index < start_index:
        return None
    
    # Extract the strict JSON content
    json_content = text[start_index : end_index + 1]

    # 3. Aggressively clean the isolated JSON content (remains the same)
    json_content = json_content.replace('“', '"').replace('”', '"').replace("‘", "'").replace("’", "'")
    json_content = json_content.replace('\xa0', ' ').replace('\u00A0', ' ')
    json_content = re.sub(r'[\x00-\x1F\x7F]', '', json_content)
    
    # 4. Attempt parsing
    try:
        return json.loads(json_content)
    except json.JSONDecodeError as e:
        print(f"Final JSONDecodeError after cleaning: {e}")
        print(f"Content that failed to load (snippet): {json_content[:200].replace('\n', '\\n')}...") 
        
        if "Expecting ',' delimiter" in str(e) or "Extra data" in str(e):
            try:
                re_pattern = r',\s*([}\]])'
                fixed_content = re.sub(re_pattern, r'\1', json_content)
                print("Attempting to fix trailing comma error...")
                return json.loads(fixed_content)
            except json.JSONDecodeError:
                pass 

        return None


# Gemini API Call Function (via OpenAI client)
# Increased max_tokens for safety, although the model will often use fewer.
def call_openai_api(prompt, max_tokens=3000):
    """Call the Gemini API using the OpenAI SDK and the compatible endpoint."""
    if client is None:
        print("❌ API client not initialized.")
        return None
        
    try:
        if not prompt.strip():
            print("⚠️ Empty prompt, skipping API call")
            return None
        
        print("➡ Sending prompt to Gemini 2.5 Lite API via OpenAI client...")

        # --- System Instruction ---
        system_content = (
            "You are an educational AI assistant. You MUST respond with ONLY valid, well-formed JSON, "
            "and no other conversational text. Do NOT wrap the JSON in markdown backticks (```json). "
            "For all mathematical or special symbols, such as square root, pi, or summation, "
            "YOU MUST USE THE ACTUAL UNICODE SYMBOL (e.g., √, π, Σ) and NOT text shortcuts (like sqrt, pi, sum)."
        )
        # --- End Instruction ---
        
        response = client.chat.completions.create(
            # Using the fast, efficient model
            model="gemini-2.5-lite", 
            messages=[
                # System instructions are crucial for format adherence
                {"role": "system", "content": system_content},
                {"role": "user", "content": prompt}
            ],
            max_tokens=max_tokens,
            temperature=0.7, 
            # 💡 CRITICAL: Force JSON output
            response_format={ "type": "json_object" } 
        )
        
        output_text = response.choices[0].message.content
        print("✅ Received response from Gemini API")
        return output_text
    except Exception as e:
        print(f"❌ Gemini API error: {e}")
        # In a production environment, this is crucial for debugging
        traceback.print_exc()
        return None

# Routes (no changes needed)
@app.route("/")
def index():
    return send_from_directory("public", "index.html")

@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory("public", path)

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "File size exceeds 50MB limit."}), 413

@app.route("/api/process-files", methods=["POST"])
def process_files():
    try:
        if "files" not in request.files:
            return jsonify({"error": "No files provided"}), 400

        files = request.files.getlist("files")
        if not files or files[0].filename == "":
            return jsonify({"error": "No files selected"}), 400

        combined_text = ""
        processed_files = []
        errors = []

        for file in files:
            if file and allowed_file(file.filename):
                filename = secure_filename(file.filename)
                
                try:
                    text = extract_text_from_file(file)
                    
                    if text and text.startswith('['):
                        errors.append(f"{filename}: {text}")
                    elif text:
                        combined_text += f"\n\n--- Content from {filename} ---\n\n{text}"
                        processed_files.append(filename)
                    else:
                        errors.append(f"{filename}: Could not extract text (returned empty content).")

                except Exception as e:
                    errors.append(f"{filename}: Processing error: {str(e)}")
            else:
                if file and file.filename:
                    errors.append(f"{file.filename}: File type not supported. Only PDF and TXT are supported.")
        
        if not combined_text.strip():
            error_msg = "Could not extract usable text from files."
            if errors:
                error_msg += " Detailed errors: " + " | ".join(errors)
            return jsonify({"error": error_msg}), 400

        if len(combined_text) > MAX_API_CONTEXT_SIZE:
            combined_text = combined_text[:MAX_API_CONTEXT_SIZE] + "\n\n[...Content truncated for API processing efficiency]"

        # --- Generate Explanation ---
        explanation_prompt = f"""You are an educational AI assistant. Follow ALL instructions exactly as written.

You will analyze the following study material and produce a structured explanation.  
You MUST follow the formatting rules exactly.  
You MUST NOT add any extra text, comments, disclaimers, apologies, introductions, conclusions, or explanations outside of the required JSON.  
You MUST NOT use markdown formatting.  
You MUST NOT wrap the JSON in backticks or code blocks.  
You MUST ONLY return valid JSON as the final output.

Study Material:
{combined_text}

Your task:

1. Create a clear, concise topic/title for the material.
2. Create **exactly 5 paragraphs** of explanation in simple, educational language.  
    Each paragraph must summarize a different key idea, concept, or section from the study material.
3. Return the output **only** in this JSON structure:

{{
  "topic": "Topic Title Here",
  "content": [
    "First paragraph of explanation...",
    "Second paragraph of explanation...",
    "Third paragraph of explanation...",
    "Fourth paragraph of explanation...",
    "Fifth paragraph of explanation..."
  ]
}}

Formatting Rules (MANDATORY):
- The JSON MUST be valid and properly formatted.
- The "topic" field MUST be a single string.
- The "content" field MUST be an array containing EXACTLY 5 strings.
- Do NOT include more or fewer paragraphs.
- Do NOT include extra fields.
- Do NOT include trailing commas.
- Do NOT include any text before or after the JSON object.

If you understand, output ONLY the JSON object following all rules above.
"""

        explanation_text = call_openai_api(explanation_prompt)
        explanation_data = None
        
        if explanation_text:
            explanation_data = clean_and_parse_json(explanation_text, is_list=False)
        
        if explanation_data is None:
            explanation_data = {
                "topic": "Study Material Analysis (Failed to Parse JSON)",
                # Fallback to first 5 newline-separated sections
                "content": explanation_text.split('\n\n')[:5] if explanation_text else ["Unable to generate explanation or parse response."]
            }
        
        # Ensure explanation_for_storage is a list containing the dictionary
        explanation_for_storage = [explanation_data] if isinstance(explanation_data, dict) else explanation_data

        # --- Generate Quiz Questions ---
        quiz_prompt = f"""Based on this study material, create 10 multiple-choice questions that thoroughly test understanding of all the important concepts.

Study Material:
{combined_text}

Create questions with:
- Clear, concise questions
- Exactly 4 answer options labeled A, B, C, D for each question
- One correct answer per question

Format your response as a JSON array of question objects, ensuring you generate exactly 10 questions:
[
  {{
    "question": "Question text here?",
    "options": [
      "A) First option",
      "B) Second option",
      "C) Third option",
      "D) Fourth option"
    ],
    "correctAnswer": "B"
  }},
  {{
    "question": "Another question?",
    "options": ["A) Option A", "B) Option B", "C) Option C", "D) Option D"],
    "correctAnswer": "A"
  }}
  // ... continue for 10 total questions
]

Only return the JSON array, no additional text or characters. DO NOT include the JSON in markdown backticks (```json)."""

        quiz_text = call_openai_api(quiz_prompt)
        quiz_data = None
        quiz_status_message = "Success"
        
        if quiz_text:
            temp_quiz_data = clean_and_parse_json(quiz_text, is_list=True)
            
            if temp_quiz_data:
                # Handle cases where the model wraps the array in a dictionary
                if not isinstance(temp_quiz_data, list):
                    if isinstance(temp_quiz_data, dict) and 'quiz' in temp_quiz_data and isinstance(temp_quiz_data['quiz'], list):
                        temp_quiz_data = temp_quiz_data['quiz']
                    elif isinstance(temp_quiz_data, dict) and 'questions' in temp_quiz_data and isinstance(temp_quiz_data['questions'], list):
                        temp_quiz_data = temp_quiz_data['questions']
                    else:
                        temp_quiz_data = [temp_quiz_data] 

                valid_questions = []
                for q in temp_quiz_data:
                    # Basic validation for a quiz question structure
                    if (isinstance(q, dict) and 
                        q.get('question') and 
                        q.get('options') and 
                        q.get('correctAnswer') and
                        isinstance(q['options'], list) and
                        len(q['options']) >= 4):
                        
                        valid_questions.append(q)
                
                quiz_data = valid_questions
            
        # Final Quiz Fallback
        if quiz_data is None or len(quiz_data) < 5: # Minimum viable quiz size check
            quiz_status_message = f"Failed to generate enough valid questions (parsed only {len(quiz_data) if quiz_data else 0}). Explanation generated successfully."
            quiz_data = [
                {
                    "question": "Quiz generation failed (Error: Not enough valid questions generated).",
                    "options": ["A) Please check the content.", "B) Try re-uploading the file.", "C) The material might be too short or complex.", "D) All of the above."],
                    "correctAnswer": "D"
                }
            ]
            
        # --- End Quiz Handling ---

        print(f"Returning explanation (length: {len(explanation_for_storage)})")
        print(f"Returning quiz (length: {len(quiz_data)})")
        
        return jsonify({
            "success": True,
            "explanation": explanation_for_storage,
            "quiz": quiz_data,
            "files_processed": processed_files,
            "quiz_status": quiz_status_message,
            "extraction_errors": errors
        })

    except Exception as e:
        print(f"Error in process_files: {e}")
        print(traceback.format_exc())
        # Return a generic 500 error for production
        return jsonify({"error": "An internal server error occurred during processing. Please check server logs."}), 500
