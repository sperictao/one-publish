import json
import os

# Steps order of modifications to SettingsDialog.tsx
steps = [43, 45, 47, 49, 51, 53, 55, 95, 97, 99, 101, 103, 105]

repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
log_path = os.environ["RESTORE_SETTINGS_LOG_PATH"]
file_path = os.path.join(repo_root, "src/components/layout/SettingsDialog.tsx")

def clean_str(s):
    if not s:
        return s
    # If s is double-JSON encoded string
    if s.startswith("\"") and s.endswith("\""):
        try:
            s = json.loads(s)
        except Exception:
            s = s[1:-1]
    # Standard normalization of escape sequences
    s = s.replace("\\n", "\n").replace("\\t", "\t").replace("\\\"", "\"").replace("\\\\", "\\")
    return s

# Read steps from transcript log
replacements = {}
with open(log_path, "r") as f:
    for line in f:
        data = json.loads(line)
        idx = data.get("step_index")
        if idx in steps:
            for tc in data.get("tool_calls", []):
                args = tc.get("args", {})
                tf = args.get("TargetFile", "")
                if tf and "SettingsDialog.tsx" in tf:
                    t = clean_str(args.get("TargetContent"))
                    r = clean_str(args.get("ReplacementContent"))
                    # Store by step index
                    replacements[idx] = (t, r)

# Read HEAD SettingsDialog.tsx
with open(file_path, "r") as f:
    content = f.read()

print(f"Original file length: {len(content)}")

all_ok = True
for step in steps:
    if step not in replacements:
        print(f"Warning: Step {step} not found in log.")
        continue
    
    target, replacement = replacements[step]
    
    # Normalize line endings to Unix LF for robust match
    target_lf = target.replace("\r\n", "\n")
    content_lf = content.replace("\r\n", "\n")
    replacement_lf = replacement.replace("\r\n", "\n")
    
    if target_lf in content_lf:
        content = content_lf.replace(target_lf, replacement_lf)
        print(f"Step {step} applied successfully.")
    else:
        print(f"Error: Step {step} FAILED to match.")
        print(f"Target snippet first 80 chars: {repr(target_lf[:80])}")
        all_ok = False
        break

if all_ok:
    # Save the reconstructed file
    with open(file_path, "w") as f:
        f.write(content)
    print("Reconstruction COMPLETED and saved.")
else:
    print("Reconstruction ABORTED due to failures.")
