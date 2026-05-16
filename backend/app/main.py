from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import shutil
import uuid
import fitz
import re

app = FastAPI(title="ConstructVision 3D")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

def classify_and_extract(pdf_path: str):
    try:
        doc = fitz.open(pdf_path)
        full_text = ""
        for page in doc:
            full_text += page.get_text("text").lower() + "\n"

        text = full_text

        # Document Type Detection
        if any(word in text for word in ["cee", "portal frame", "r-panel", "girt", "purlin", "steel commander", "ysui"]):
            doc_type = "steel_building"
        elif any(word in text for word in ["drip field", "aeration tank", "septic", "wastewater", "curtain drain", "geoflow"]):
            doc_type = "wastewater"
        elif any(word in text for word in ["foundation", "anchor bolt", "slab", "footing"]):
            doc_type = "foundation"
        else:
            doc_type = "general_building"

        # Extract dimensions
        numbers = re.findall(r'(\d{1,3}(?:\.\d+)?)\s*(?:\'|ft|feet|x|by)?', text)
        numbers = [float(n) for n in numbers if 5 < float(n) < 500]

        extracted = {
            "doc_type": doc_type,
            "width": numbers[0] if len(numbers) > 0 else 50,
            "length": numbers[1] if len(numbers) > 1 else 80,
            "height": numbers[2] if len(numbers) > 2 else 20,
            "raw_numbers": len(numbers),
            "text_sample": text[:600]
        }

        print(f"Detected document type: {doc_type}")
        return extracted

    except Exception as e:
        return {"doc_type": "general_building", "width": 50, "length": 80, "height": 20, "error": str(e)}

@app.post("/upload/")
async def upload_documents(files: list[UploadFile] = File(...)):
    project_id = f"proj_{uuid.uuid4().hex[:12]}"
    extracted_data = {"doc_type": "general_building", "width": 50, "length": 80, "height": 20}

    for file in files:
        file_path = UPLOAD_DIR / f"{project_id}_{file.filename}"
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        
        if file.filename.lower().endswith(".pdf"):
            extracted_data = classify_and_extract(str(file_path))

    return {
        "project_id": project_id,
        "extracted_data": extracted_data,
        "message": "Processing complete"
    }