import zipfile
import os
import sys

zip_path = r"C:\Users\win11\Desktop\logs_79951333428.zip"
dest = r"C:\Users\win11\Desktop\FH Blog\agent-tools\logs-79951333428"

os.makedirs(dest, exist_ok=True)
with zipfile.ZipFile(zip_path, 'r') as zf:
    zf.extractall(dest)
    for info in zf.infolist():
        print(f"{info.file_size}\t{info.filename}")